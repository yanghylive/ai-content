import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { getKaypalPlanRank, normalizeKaypalPlan } from '../auth/plan-order';
import { TenantsService } from '../tenants/tenants.service';
import type {
  BillingReadinessEvidence,
  BillingInvoicePayload,
  BillingStatus,
  BillingSubscriptionPayload,
  BillingWebhookHeaders,
  BillingWebhookPayload,
  BillingWebhookResult,
} from './billing.types';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
  ) {}

  async processWebhook(
    providerInput: string,
    payload: BillingWebhookPayload,
    headers: BillingWebhookHeaders,
  ): Promise<BillingWebhookResult> {
    const provider = this.normalizeProvider(providerInput);
    const signatureVerified = this.verifyWebhookSignature(
      provider,
      payload,
      headers,
    );
    const eventId = this.requireString(
      payload.eventId ?? payload.id,
      'eventId',
    );
    const eventType = this.requireString(
      payload.eventType ?? payload.type,
      'eventType',
    );
    const existing = await this.prisma.billingWebhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider,
          eventId,
        },
      },
    });

    if (
      existing &&
      ['processed', 'ignored_out_of_order'].includes(existing.status)
    ) {
      return {
        provider,
        eventId,
        eventType,
        duplicate: true,
        processed: true,
        tenantId: existing.tenantId,
        subscriptionId: existing.externalSubscriptionId,
        plan: null,
        status: existing.status,
        commercialExecutionAllowed: false,
        message: '计费 webhook 已处理过，本次按幂等重复事件跳过。',
      };
    }

    if (this.isInvoiceEvent(eventType, payload)) {
      return this.processInvoiceWebhook({
        provider,
        eventId,
        eventType,
        payload,
        signatureVerified,
        existingEventId: existing?.id ?? null,
      });
    }

    const subscription = this.extractSubscription(payload);
    const externalCustomerId =
      this.toString(subscription.customerId) ||
      this.toString(payload.customerId);
    const externalSubscriptionId =
      this.toString(subscription.subscriptionId) ||
      this.toString(subscription.id) ||
      this.toString(payload.subscriptionId);

    if (!externalSubscriptionId) {
      throw new BadRequestException('计费 webhook 缺少 subscriptionId');
    }

    const eventOccurredAt = this.resolveEventOccurredAt(payload, subscription);
    const currentSubscription =
      await this.prisma.billingSubscription.findUnique({
        where: {
          provider_externalSubscriptionId: {
            provider,
            externalSubscriptionId,
          },
        },
      });
    if (
      this.isOutOfOrderBillingEvent(
        eventOccurredAt,
        currentSubscription?.metadata,
      )
    ) {
      return this.recordOutOfOrderWebhook({
        provider,
        eventId,
        eventType,
        payload,
        signatureVerified,
        existingEventId: existing?.id ?? null,
        tenantId: currentSubscription?.tenantId ?? null,
        externalCustomerId,
        externalSubscriptionId,
        eventOccurredAt,
        plan: currentSubscription?.plan ?? null,
        status: currentSubscription?.status ?? 'ignored_out_of_order',
      });
    }

    const plan = normalizeKaypalPlan(subscription.plan);
    const status = this.normalizeSubscriptionStatus(
      subscription.status,
      eventType,
    );
    const currentPeriodStart = this.toDate(
      subscription.currentPeriodStart ?? subscription.periodStart,
    );
    const currentPeriodEnd = this.toDate(
      subscription.currentPeriodEnd ?? subscription.periodEnd,
    );
    const cancelAtPeriodEnd = subscription.cancelAtPeriodEnd === true;
    const commercialExecutionAllowed = this.isCommercialSubscription({
      plan,
      status,
      currentPeriodEnd,
    });
    const entitlementStatus = this.resolveEntitlementStatus({
      status,
      currentPeriodEnd,
      commercialExecutionAllowed,
    });
    const features = this.resolveFeatures(plan, commercialExecutionAllowed);
    const tenantId = await this.resolveTenantId({
      payload,
      provider,
      externalCustomerId,
      externalSubscriptionId,
      plan,
      status,
      features,
      commercialExecutionAllowed,
    });
    const now = new Date();
    const eventData = {
      provider,
      eventId,
      eventType,
      tenantId,
      externalCustomerId,
      externalSubscriptionId,
      signatureVerified,
      status: 'received',
      payload: payload as Prisma.InputJsonValue,
      metadata: {
        userId: this.toString(payload.userId),
        kaypalUserId: this.toString(payload.kaypalUserId),
        billingEventOccurredAt: eventOccurredAt?.toISOString() ?? null,
      } as Prisma.InputJsonValue,
    };

    if (existing) {
      await this.prisma.billingWebhookEvent.update({
        where: { id: existing.id },
        data: {
          ...eventData,
          updatedAt: now,
        },
      });
    } else {
      await this.prisma.billingWebhookEvent.create({
        data: eventData,
      });
    }

    await this.prisma.billingSubscription.upsert({
      where: {
        provider_externalSubscriptionId: {
          provider,
          externalSubscriptionId,
        },
      },
      create: {
        tenantId,
        provider,
        externalCustomerId,
        externalSubscriptionId,
        plan,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd,
        latestWebhookEventId: eventId,
        metadata: {
          ...this.toJsonObject(subscription.metadata),
          billingEventOccurredAt: eventOccurredAt?.toISOString() ?? null,
          latestWebhookEventId: eventId,
        } as Prisma.InputJsonValue,
      },
      update: {
        tenantId,
        externalCustomerId,
        plan,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd,
        latestWebhookEventId: eventId,
        metadata: {
          ...this.toJsonObject(subscription.metadata),
          billingEventOccurredAt: eventOccurredAt?.toISOString() ?? null,
          latestWebhookEventId: eventId,
        } as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });

    await this.prisma.tenantEntitlement.upsert({
      where: {
        tenantId_source: {
          tenantId,
          source: 'kaypal-subscription',
        },
      },
      create: {
        tenantId,
        source: 'kaypal-subscription',
        plan,
        status: entitlementStatus,
        features: features as Prisma.InputJsonValue,
        commercialExecutionAllowed,
        externalSubscriptionId,
        periodStart: currentPeriodStart,
        periodEnd: currentPeriodEnd,
        metadata: {
          provider,
          eventId,
          eventType,
          externalCustomerId,
          cancelAtPeriodEnd,
          billingStatus: status,
          billingEventOccurredAt: eventOccurredAt?.toISOString() ?? null,
        } as Prisma.InputJsonValue,
      },
      update: {
        plan,
        status: entitlementStatus,
        features: features as Prisma.InputJsonValue,
        commercialExecutionAllowed,
        externalSubscriptionId,
        periodStart: currentPeriodStart,
        periodEnd: currentPeriodEnd,
        metadata: {
          provider,
          eventId,
          eventType,
          externalCustomerId,
          cancelAtPeriodEnd,
          billingStatus: status,
          billingEventOccurredAt: eventOccurredAt?.toISOString() ?? null,
        } as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });

    await this.prisma.billingWebhookEvent.updateMany({
      where: {
        provider,
        eventId,
      },
      data: {
        status: 'processed',
        processedAt: now,
        errorMessage: null,
      },
    });

    return {
      provider,
      eventId,
      eventType,
      duplicate: false,
      processed: true,
      tenantId,
      subscriptionId: externalSubscriptionId,
      plan,
      status,
      commercialExecutionAllowed,
      message: commercialExecutionAllowed
        ? '计费 webhook 已处理，租户商用授权已更新。'
        : '计费 webhook 已处理，订阅状态未满足商用执行条件。',
    };
  }

  private async processInvoiceWebhook(input: {
    provider: string;
    eventId: string;
    eventType: string;
    payload: BillingWebhookPayload;
    signatureVerified: boolean;
    existingEventId: string | null;
  }): Promise<BillingWebhookResult> {
    const invoice = this.extractInvoice(input.payload);
    const eventOccurredAt = this.resolveEventOccurredAt(input.payload, invoice);
    const externalInvoiceId = this.requireString(
      invoice.invoiceId ?? invoice.id ?? input.payload.invoiceId,
      'invoiceId',
    );
    const externalCustomerId =
      this.toString(invoice.customerId) ||
      this.toString(input.payload.customerId);
    const externalSubscriptionId =
      this.toString(invoice.subscriptionId) ||
      this.toString(invoice.subscription) ||
      this.toString(input.payload.subscriptionId);
    const invoiceStatus = this.normalizeInvoiceStatus(
      invoice.status,
      input.eventType,
    );
    const [currentInvoice, currentSubscription] = await Promise.all([
      this.prisma.billingInvoice.findUnique({
        where: {
          provider_externalInvoiceId: {
            provider: input.provider,
            externalInvoiceId,
          },
        },
      }),
      externalSubscriptionId
        ? this.prisma.billingSubscription.findUnique({
            where: {
              provider_externalSubscriptionId: {
                provider: input.provider,
                externalSubscriptionId,
              },
            },
          })
        : null,
    ]);
    if (
      this.isOutOfOrderBillingEvent(eventOccurredAt, [
        currentInvoice?.metadata,
        currentSubscription?.metadata,
      ])
    ) {
      return this.recordOutOfOrderWebhook({
        provider: input.provider,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        signatureVerified: input.signatureVerified,
        existingEventId: input.existingEventId,
        tenantId:
          currentInvoice?.tenantId ?? currentSubscription?.tenantId ?? null,
        externalCustomerId,
        externalSubscriptionId,
        eventOccurredAt,
        plan: currentSubscription?.plan ?? null,
        status: currentInvoice?.status ?? 'ignored_out_of_order',
      });
    }
    const tenantId = await this.resolveTenantId({
      payload: input.payload,
      provider: input.provider,
      externalCustomerId,
      externalSubscriptionId,
      plan: 'FREE',
      status: invoiceStatus,
      features: this.resolveFeatures('FREE', false),
      commercialExecutionAllowed: false,
    });
    const now = new Date();
    const eventData = {
      provider: input.provider,
      eventId: input.eventId,
      eventType: input.eventType,
      tenantId,
      externalCustomerId,
      externalSubscriptionId,
      signatureVerified: input.signatureVerified,
      status: 'received',
      payload: input.payload as Prisma.InputJsonValue,
      metadata: {
        userId: this.toString(input.payload.userId),
        kaypalUserId: this.toString(input.payload.kaypalUserId),
        externalInvoiceId,
        billingEventOccurredAt: eventOccurredAt?.toISOString() ?? null,
      } as Prisma.InputJsonValue,
    };

    if (input.existingEventId) {
      await this.prisma.billingWebhookEvent.update({
        where: { id: input.existingEventId },
        data: {
          ...eventData,
          updatedAt: now,
        },
      });
    } else {
      await this.prisma.billingWebhookEvent.create({ data: eventData });
    }

    await this.prisma.billingInvoice.upsert({
      where: {
        provider_externalInvoiceId: {
          provider: input.provider,
          externalInvoiceId,
        },
      },
      create: {
        tenantId,
        provider: input.provider,
        externalInvoiceId,
        externalCustomerId,
        externalSubscriptionId,
        status: invoiceStatus,
        amountDue: this.toInteger(invoice.amountDue ?? invoice.amount_due),
        amountPaid: this.toInteger(invoice.amountPaid ?? invoice.amount_paid),
        currency: this.normalizeCurrency(invoice.currency),
        hostedInvoiceUrl: this.toString(
          invoice.hostedInvoiceUrl ?? invoice.hosted_invoice_url,
        ),
        invoicePdfUrl: this.toString(
          invoice.invoicePdfUrl ?? invoice.invoice_pdf,
        ),
        attemptedAt: this.toDate(invoice.attemptedAt ?? invoice.created),
        paidAt: this.isPaidInvoiceStatus(invoiceStatus)
          ? (this.toDate(invoice.paidAt ?? invoice.created) ?? now)
          : null,
        failedAt: this.isFailedInvoiceStatus(invoiceStatus)
          ? (this.toDate(invoice.failedAt ?? invoice.created) ?? now)
          : null,
        latestWebhookEventId: input.eventId,
        metadata: {
          ...this.toJsonObject(invoice.metadata),
          billingEventOccurredAt: eventOccurredAt?.toISOString() ?? null,
          latestWebhookEventId: input.eventId,
        } as Prisma.InputJsonValue,
      },
      update: {
        tenantId,
        externalCustomerId,
        externalSubscriptionId,
        status: invoiceStatus,
        amountDue: this.toInteger(invoice.amountDue ?? invoice.amount_due),
        amountPaid: this.toInteger(invoice.amountPaid ?? invoice.amount_paid),
        currency: this.normalizeCurrency(invoice.currency),
        hostedInvoiceUrl: this.toString(
          invoice.hostedInvoiceUrl ?? invoice.hosted_invoice_url,
        ),
        invoicePdfUrl: this.toString(
          invoice.invoicePdfUrl ?? invoice.invoice_pdf,
        ),
        attemptedAt: this.toDate(invoice.attemptedAt ?? invoice.created),
        paidAt: this.isPaidInvoiceStatus(invoiceStatus)
          ? (this.toDate(invoice.paidAt ?? invoice.created) ?? now)
          : null,
        failedAt: this.isFailedInvoiceStatus(invoiceStatus)
          ? (this.toDate(invoice.failedAt ?? invoice.created) ?? now)
          : null,
        latestWebhookEventId: input.eventId,
        metadata: {
          ...this.toJsonObject(invoice.metadata),
          billingEventOccurredAt: eventOccurredAt?.toISOString() ?? null,
          latestWebhookEventId: input.eventId,
        } as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });

    const lifecycle = await this.applyInvoiceLifecycle({
      tenantId,
      provider: input.provider,
      eventId: input.eventId,
      eventType: input.eventType,
      invoiceStatus,
      externalCustomerId,
      externalSubscriptionId,
      invoice,
      eventOccurredAt,
      now,
    });

    await this.prisma.billingWebhookEvent.updateMany({
      where: {
        provider: input.provider,
        eventId: input.eventId,
      },
      data: {
        status: 'processed',
        processedAt: now,
        errorMessage: null,
      },
    });

    return {
      provider: input.provider,
      eventId: input.eventId,
      eventType: input.eventType,
      duplicate: false,
      processed: true,
      tenantId,
      subscriptionId: externalSubscriptionId,
      plan: lifecycle.plan,
      status: invoiceStatus,
      commercialExecutionAllowed: lifecycle.commercialExecutionAllowed,
      message: lifecycle.message,
    };
  }

  async getStatusForUser(user: AuthenticatedUser): Promise<BillingStatus> {
    const features = this.resolveFeatures(user.kaypalPlan || 'FREE', false);
    const tenant = await this.tenants.ensureDefaultTenantForUser({
      user,
      entitlement: {
        source: 'trial',
        plan: normalizeKaypalPlan(user.kaypalPlan),
        status: 'active',
        features,
        commercialExecutionAllowed: false,
        metadata: { source: 'billing-status-read' },
      },
    });
    const [entitlement, subscription, invoice] = await Promise.all([
      this.prisma.tenantEntitlement.findFirst({
        where: { tenantId: tenant.tenantId, source: 'kaypal-subscription' },
        orderBy: [{ updatedAt: 'desc' }],
      }),
      this.optionalBillingRecord(() =>
        this.prisma.billingSubscription.findFirst({
          where: { tenantId: tenant.tenantId },
          orderBy: [{ updatedAt: 'desc' }],
        }),
      ),
      this.optionalBillingRecord(() =>
        this.prisma.billingInvoice.findFirst({
          where: { tenantId: tenant.tenantId },
          orderBy: [{ updatedAt: 'desc' }],
        }),
      ),
    ]);

    return {
      tenantId: tenant.tenantId,
      user: {
        id: user.id,
        email: user.email,
        kaypalUserId: user.kaypalUserId ?? null,
      },
      entitlement: entitlement
        ? {
            source: entitlement.source,
            plan: entitlement.plan,
            status: entitlement.status,
            commercialExecutionAllowed: entitlement.commercialExecutionAllowed,
            externalSubscriptionId: entitlement.externalSubscriptionId,
            periodEnd: entitlement.periodEnd?.toISOString() ?? null,
          }
        : null,
      latestSubscription: subscription
        ? {
            provider: subscription.provider,
            externalSubscriptionId: subscription.externalSubscriptionId,
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodEnd:
              subscription.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
      latestInvoice: invoice
        ? {
            provider: invoice.provider,
            externalInvoiceId: invoice.externalInvoiceId,
            externalSubscriptionId: invoice.externalSubscriptionId,
            status: invoice.status,
            amountDue: invoice.amountDue,
            amountPaid: invoice.amountPaid,
            currency: invoice.currency,
            paidAt: invoice.paidAt?.toISOString() ?? null,
            failedAt: invoice.failedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  private async optionalBillingRecord<T>(
    loadRecord: () => Promise<T | null>,
  ): Promise<T | null> {
    try {
      return await loadRecord();
    } catch (error) {
      if (this.isOptionalBillingStorageError(error)) return null;
      throw error;
    }
  }

  private isOptionalBillingStorageError(error: unknown) {
    const record =
      error && typeof error === 'object'
        ? (error as { code?: unknown; message?: unknown })
        : {};
    const code = typeof record.code === 'string' ? record.code : '';
    const message =
      typeof record.message === 'string' ? record.message.toLowerCase() : '';

    return (
      code === 'P2021' ||
      code === 'P2022' ||
      message.includes('billing_subscriptions') ||
      message.includes('billing_invoices') ||
      message.includes('billingSubscription') ||
      message.includes('billingInvoice')
    );
  }

  async getReadinessEvidence(): Promise<BillingReadinessEvidence> {
    try {
      const now = new Date();
      const [
        latestEvent,
        latestSubscription,
        latestInvoice,
        activeSubscriptionCount,
        verifiedWebhookCount,
        processedWebhookCount,
        invoiceAuditCount,
        failedInvoiceCount,
        lifecycleEventCount,
      ] = await Promise.all([
        this.prisma.billingWebhookEvent.findFirst({
          orderBy: [{ createdAt: 'desc' }],
        }),
        this.prisma.billingSubscription.findFirst({
          orderBy: [{ updatedAt: 'desc' }],
        }),
        this.prisma.billingInvoice.findFirst({
          orderBy: [{ updatedAt: 'desc' }],
        }),
        this.prisma.billingSubscription.count({
          where: {
            status: { in: ['active', 'trialing', 'paid'] },
            OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
          },
        }),
        this.prisma.billingWebhookEvent.count({
          where: { signatureVerified: true },
        }),
        this.prisma.billingWebhookEvent.count({
          where: { status: 'processed' },
        }),
        this.prisma.billingInvoice.count(),
        this.prisma.billingInvoice.count({
          where: {
            status: {
              in: ['failed', 'payment_failed', 'past_due', 'uncollectible'],
            },
          },
        }),
        this.prisma.billingWebhookEvent.count({
          where: {
            status: 'processed',
            eventType: {
              in: [
                'customer.subscription.created',
                'customer.subscription.updated',
                'customer.subscription.deleted',
                'invoice.paid',
                'invoice.payment_failed',
              ],
            },
          },
        }),
      ]);
      const webhookSecretConfigured = this.isAnyWebhookSecretConfigured();

      return {
        configured:
          webhookSecretConfigured &&
          activeSubscriptionCount > 0 &&
          verifiedWebhookCount > 0 &&
          processedWebhookCount > 0 &&
          invoiceAuditCount > 0,
        webhookSecretConfigured,
        latestEventAt: latestEvent?.createdAt.toISOString() ?? null,
        latestEventStatus: latestEvent?.status ?? null,
        latestProvider: latestEvent?.provider ?? null,
        latestSubscriptionStatus: latestSubscription?.status ?? null,
        latestSubscriptionPlan: latestSubscription?.plan ?? null,
        latestInvoiceStatus: latestInvoice?.status ?? null,
        activeSubscriptionCount,
        verifiedWebhookCount,
        processedWebhookCount,
        invoiceAuditCount,
        failedInvoiceCount,
        lifecycleEventCount,
      };
    } catch {
      return {
        configured: false,
        webhookSecretConfigured: this.isAnyWebhookSecretConfigured(),
        latestEventAt: null,
        latestEventStatus: null,
        latestProvider: null,
        latestSubscriptionStatus: null,
        latestSubscriptionPlan: null,
        latestInvoiceStatus: null,
        activeSubscriptionCount: 0,
        verifiedWebhookCount: 0,
        processedWebhookCount: 0,
        invoiceAuditCount: 0,
        failedInvoiceCount: 0,
        lifecycleEventCount: 0,
      };
    }
  }

  private async resolveTenantId(input: {
    payload: BillingWebhookPayload;
    provider: string;
    externalCustomerId: string | null;
    externalSubscriptionId: string | null;
    plan: string;
    status: string;
    features: string[];
    commercialExecutionAllowed: boolean;
  }): Promise<string> {
    const payloadTenantId = this.toString(input.payload.tenantId);
    if (payloadTenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: payloadTenantId },
        select: { id: true },
      });
      if (!tenant) {
        throw new BadRequestException(`租户不存在：${payloadTenantId}`);
      }
      return tenant.id;
    }

    if (input.externalSubscriptionId) {
      const existingSubscription =
        await this.prisma.billingSubscription.findUnique({
          where: {
            provider_externalSubscriptionId: {
              provider: input.provider,
              externalSubscriptionId: input.externalSubscriptionId,
            },
          },
          select: { tenantId: true },
        });
      if (existingSubscription?.tenantId) return existingSubscription.tenantId;
    }

    if (input.externalCustomerId) {
      const subscriptionByCustomer =
        await this.prisma.billingSubscription.findFirst({
          where: {
            provider: input.provider,
            externalCustomerId: input.externalCustomerId,
          },
          select: { tenantId: true },
          orderBy: [{ updatedAt: 'desc' }],
        });
      if (subscriptionByCustomer?.tenantId)
        return subscriptionByCustomer.tenantId;
    }

    const user = await this.resolveUser(input.payload);
    if (!user) {
      throw new BadRequestException(
        '计费 webhook 无法定位租户，请提供 tenantId、userId、kaypalUserId 或已有 customer/subscription 关联。',
      );
    }

    const tenant = await this.tenants.ensureDefaultTenantForUser({
      user: this.toAuthenticatedUser(user, input),
      entitlement: {
        source: 'kaypal-subscription',
        plan: input.plan,
        status: input.commercialExecutionAllowed ? 'active' : input.status,
        features: input.features,
        commercialExecutionAllowed: input.commercialExecutionAllowed,
        metadata: {
          source: 'billing-webhook',
          provider: input.provider,
          externalCustomerId: input.externalCustomerId,
          externalSubscriptionId: input.externalSubscriptionId,
        },
      },
    });

    return tenant.tenantId;
  }

  private async resolveUser(payload: BillingWebhookPayload) {
    const userId = this.toString(payload.userId);
    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user) return user;
    }

    const kaypalUserId = this.toString(payload.kaypalUserId);
    if (kaypalUserId) {
      const user = await this.prisma.user.findFirst({
        where: { kaypalUserId },
      });
      if (user) return user;
    }

    return null;
  }

  private toAuthenticatedUser(
    user: User,
    input: {
      plan: string;
      commercialExecutionAllowed: boolean;
    },
  ): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      kaypalUserId: user.kaypalUserId,
      kaypalPlan: input.plan,
      kaypalPlanExpired: false,
      kaypalRole: null,
      kaypalPlatformRole: null,
      kaypalPermissionNames: [],
      role: user.role,
      commercialExecutionAllowed: input.commercialExecutionAllowed,
      planMode: input.commercialExecutionAllowed ? 'commercial' : 'trial',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private extractSubscription(
    payload: BillingWebhookPayload,
  ): BillingSubscriptionPayload {
    const direct = this.toRecord(payload.subscription);
    const data = this.toRecord(payload.data);
    const nestedObject = this.toRecord(data.object);
    return {
      ...this.toRecord(payload),
      ...data,
      ...nestedObject,
      ...direct,
      metadata:
        direct.metadata ??
        nestedObject.metadata ??
        data.metadata ??
        payload.metadata,
    };
  }

  private extractInvoice(
    payload: BillingWebhookPayload,
  ): BillingInvoicePayload {
    const direct = this.toRecord(payload.invoice);
    const data = this.toRecord(payload.data);
    const nestedObject = this.toRecord(data.object);
    return {
      ...this.toRecord(payload),
      ...data,
      ...nestedObject,
      ...direct,
      invoiceId:
        direct.invoiceId ??
        direct.id ??
        nestedObject.invoiceId ??
        nestedObject.id ??
        data.invoiceId ??
        payload.invoiceId,
      subscriptionId:
        direct.subscriptionId ??
        direct.subscription ??
        nestedObject.subscriptionId ??
        nestedObject.subscription ??
        data.subscriptionId ??
        payload.subscriptionId,
      metadata:
        direct.metadata ??
        nestedObject.metadata ??
        data.metadata ??
        payload.metadata,
    };
  }

  private async applyInvoiceLifecycle(input: {
    tenantId: string;
    provider: string;
    eventId: string;
    eventType: string;
    invoiceStatus: string;
    externalCustomerId: string | null;
    externalSubscriptionId: string | null;
    invoice: BillingInvoicePayload;
    eventOccurredAt: Date | null;
    now: Date;
  }): Promise<{
    plan: string | null;
    commercialExecutionAllowed: boolean;
    message: string;
  }> {
    if (!input.externalSubscriptionId) {
      return {
        plan: null,
        commercialExecutionAllowed: false,
        message: '发票 webhook 已审计，但没有 subscriptionId，未改动订阅授权。',
      };
    }

    const subscription = await this.prisma.billingSubscription.findUnique({
      where: {
        provider_externalSubscriptionId: {
          provider: input.provider,
          externalSubscriptionId: input.externalSubscriptionId,
        },
      },
    });

    if (!subscription) {
      return {
        plan: null,
        commercialExecutionAllowed: false,
        message: '发票 webhook 已审计，但没有找到既有订阅，未改动租户授权。',
      };
    }

    if (this.isFailedInvoiceStatus(input.invoiceStatus)) {
      await this.prisma.billingSubscription.update({
        where: {
          provider_externalSubscriptionId: {
            provider: input.provider,
            externalSubscriptionId: input.externalSubscriptionId,
          },
        },
        data: {
          status: 'past_due',
          latestWebhookEventId: input.eventId,
          metadata: {
            ...this.toJsonObject(subscription.metadata),
            billingEventOccurredAt:
              input.eventOccurredAt?.toISOString() ?? null,
            latestWebhookEventId: input.eventId,
          } as Prisma.InputJsonValue,
          updatedAt: input.now,
        },
      });
      await this.prisma.tenantEntitlement.updateMany({
        where: {
          tenantId: input.tenantId,
          source: 'kaypal-subscription',
          externalSubscriptionId: input.externalSubscriptionId,
        },
        data: {
          status: 'past_due',
          commercialExecutionAllowed: false,
          metadata: {
            provider: input.provider,
            eventId: input.eventId,
            eventType: input.eventType,
            externalCustomerId: input.externalCustomerId,
            billingStatus: 'past_due',
            invoiceStatus: input.invoiceStatus,
            billingEventOccurredAt:
              input.eventOccurredAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
          updatedAt: input.now,
        },
      });
      return {
        plan: subscription.plan,
        commercialExecutionAllowed: false,
        message: '支付失败 webhook 已审计，订阅和租户授权已降级为 past_due。',
      };
    }

    if (this.isPaidInvoiceStatus(input.invoiceStatus)) {
      const renewalPeriodEnd =
        this.toDate(input.invoice.currentPeriodEnd) ||
        this.toDate(input.invoice.periodEnd) ||
        this.toDate(this.toRecord(input.invoice.metadata).currentPeriodEnd) ||
        subscription.currentPeriodEnd;
      const commercialExecutionAllowed = this.isCommercialSubscription({
        plan: subscription.plan,
        status: 'active',
        currentPeriodEnd: renewalPeriodEnd,
      });
      const features = this.resolveFeatures(
        subscription.plan,
        commercialExecutionAllowed,
      );

      await this.prisma.billingSubscription.update({
        where: {
          provider_externalSubscriptionId: {
            provider: input.provider,
            externalSubscriptionId: input.externalSubscriptionId,
          },
        },
        data: {
          status: 'active',
          currentPeriodEnd: renewalPeriodEnd,
          latestWebhookEventId: input.eventId,
          metadata: {
            ...this.toJsonObject(subscription.metadata),
            billingEventOccurredAt:
              input.eventOccurredAt?.toISOString() ?? null,
            latestWebhookEventId: input.eventId,
          } as Prisma.InputJsonValue,
          updatedAt: input.now,
        },
      });
      await this.prisma.tenantEntitlement.upsert({
        where: {
          tenantId_source: {
            tenantId: input.tenantId,
            source: 'kaypal-subscription',
          },
        },
        create: {
          tenantId: input.tenantId,
          source: 'kaypal-subscription',
          plan: subscription.plan,
          status: commercialExecutionAllowed ? 'active' : 'expired',
          features: features as Prisma.InputJsonValue,
          commercialExecutionAllowed,
          externalSubscriptionId: input.externalSubscriptionId,
          periodStart: subscription.currentPeriodStart,
          periodEnd: renewalPeriodEnd,
          metadata: {
            provider: input.provider,
            eventId: input.eventId,
            eventType: input.eventType,
            externalCustomerId: input.externalCustomerId,
            billingStatus: 'active',
            invoiceStatus: input.invoiceStatus,
            billingEventOccurredAt:
              input.eventOccurredAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
        },
        update: {
          plan: subscription.plan,
          status: commercialExecutionAllowed ? 'active' : 'expired',
          features: features as Prisma.InputJsonValue,
          commercialExecutionAllowed,
          externalSubscriptionId: input.externalSubscriptionId,
          periodStart: subscription.currentPeriodStart,
          periodEnd: renewalPeriodEnd,
          metadata: {
            provider: input.provider,
            eventId: input.eventId,
            eventType: input.eventType,
            externalCustomerId: input.externalCustomerId,
            billingStatus: 'active',
            invoiceStatus: input.invoiceStatus,
            billingEventOccurredAt:
              input.eventOccurredAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
          updatedAt: input.now,
        },
      });
      return {
        plan: subscription.plan,
        commercialExecutionAllowed,
        message: commercialExecutionAllowed
          ? '续费发票 webhook 已审计，订阅和租户授权保持 active。'
          : '续费发票 webhook 已审计，但订阅周期无效，未开放商用执行。',
      };
    }

    return {
      plan: subscription.plan,
      commercialExecutionAllowed: subscription.status === 'active',
      message: '发票 webhook 已审计，未触发订阅授权变更。',
    };
  }

  private resolveEventOccurredAt(
    payload: BillingWebhookPayload,
    entity: unknown,
  ) {
    const data = this.toRecord(payload.data);
    const nestedObject = this.toRecord(data.object);
    const entityRecord = this.toRecord(entity);
    const records = [
      this.toRecord(payload),
      this.toRecord(payload.metadata),
      data,
      this.toRecord(data.metadata),
      nestedObject,
      this.toRecord(nestedObject.metadata),
      this.toRecord(entityRecord.metadata),
    ];
    const keys = [
      'eventOccurredAt',
      'eventCreatedAt',
      'eventTimestamp',
      'occurredAt',
      'timestamp',
      'createdAt',
      'created',
    ];
    for (const record of records) {
      for (const key of keys) {
        const parsed = this.toDate(record[key]);
        if (parsed) return parsed;
      }
    }
    return null;
  }

  private isOutOfOrderBillingEvent(incoming: Date | null, metadata: unknown) {
    if (!incoming) return false;
    const values = Array.isArray(metadata) ? metadata : [metadata];
    const latest = values
      .map((value) => this.billingEventTimestamp(value))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    return Boolean(latest && incoming.getTime() < latest.getTime());
  }

  private billingEventTimestamp(metadata: unknown) {
    const record = this.toRecord(metadata);
    const nested = this.toRecord(record.billingEvent);
    for (const value of [
      record.billingEventOccurredAt,
      record.eventOccurredAt,
      record.eventCreatedAt,
      record.eventTimestamp,
      nested.occurredAt,
      nested.createdAt,
      nested.timestamp,
    ]) {
      const parsed = this.toDate(value);
      if (parsed) return parsed;
    }
    return null;
  }

  private async recordOutOfOrderWebhook(input: {
    provider: string;
    eventId: string;
    eventType: string;
    payload: BillingWebhookPayload;
    signatureVerified: boolean;
    existingEventId: string | null;
    tenantId: string | null;
    externalCustomerId: string | null;
    externalSubscriptionId: string | null;
    eventOccurredAt: Date | null;
    plan: string | null;
    status: string;
  }): Promise<BillingWebhookResult> {
    const now = new Date();
    const data = {
      provider: input.provider,
      eventId: input.eventId,
      eventType: input.eventType,
      tenantId: input.tenantId,
      externalCustomerId: input.externalCustomerId,
      externalSubscriptionId: input.externalSubscriptionId,
      signatureVerified: input.signatureVerified,
      status: 'ignored_out_of_order',
      payload: input.payload as Prisma.InputJsonValue,
      metadata: {
        reason: 'out_of_order',
        billingEventOccurredAt: input.eventOccurredAt?.toISOString() ?? null,
      } as Prisma.InputJsonValue,
      processedAt: now,
      errorMessage: null,
    };
    if (input.existingEventId) {
      await this.prisma.billingWebhookEvent.update({
        where: { id: input.existingEventId },
        data: { ...data, updatedAt: now },
      });
    } else {
      await this.prisma.billingWebhookEvent.create({ data });
    }
    return {
      provider: input.provider,
      eventId: input.eventId,
      eventType: input.eventType,
      duplicate: false,
      processed: false,
      tenantId: input.tenantId,
      subscriptionId: input.externalSubscriptionId,
      plan: input.plan,
      status: 'ignored_out_of_order',
      commercialExecutionAllowed: false,
      message: '收到较早的计费事件，已保留记录但未改动当前订阅状态。',
    };
  }

  private verifyWebhookSignature(
    provider: string,
    payload: BillingWebhookPayload,
    headers: BillingWebhookHeaders,
  ) {
    const secret = this.resolveWebhookSecret(provider);
    if (!secret) {
      throw new UnauthorizedException(
        '计费 webhook secret 未配置，拒绝接收未签名回调。',
      );
    }

    const signature = this.resolveSignatureHeader(provider, headers);
    if (!signature) {
      throw new UnauthorizedException('计费 webhook 缺少签名头。');
    }

    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    const candidates = this.signatureCandidates(signature);
    if (
      !candidates.some((candidate) => this.safeCompare(candidate, expected))
    ) {
      throw new UnauthorizedException('计费 webhook 签名校验失败。');
    }

    return true;
  }

  private normalizeProvider(providerInput: string) {
    const provider = (providerInput || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(provider)) {
      throw new BadRequestException('不支持的计费 provider');
    }
    return provider;
  }

  private resolveWebhookSecret(provider: string) {
    const upper = provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const candidates = [
      `${upper}_BILLING_WEBHOOK_SECRET`,
      `${upper}_WEBHOOK_SECRET`,
      'BILLING_WEBHOOK_SECRET',
      provider === 'kaypal' ? 'KAYPAL_BILLING_WEBHOOK_SECRET' : '',
      provider === 'stripe' ? 'STRIPE_WEBHOOK_SECRET' : '',
    ].filter(Boolean);
    for (const name of candidates) {
      const value = process.env[name]?.trim();
      if (value) return value;
    }
    return null;
  }

  private isAnyWebhookSecretConfigured() {
    return [
      'BILLING_WEBHOOK_SECRET',
      'KAYPAL_BILLING_WEBHOOK_SECRET',
      'KAYPAL_WEBHOOK_SECRET',
      'STRIPE_WEBHOOK_SECRET',
    ].some((name) => Boolean(process.env[name]?.trim()));
  }

  private resolveSignatureHeader(
    provider: string,
    headers: BillingWebhookHeaders,
  ) {
    const lower = Object.fromEntries(
      Object.entries(headers || {}).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );
    return this.headerValue(
      lower['x-kaypal-signature'] ||
        lower['x-billing-signature'] ||
        lower[`${provider}-signature`] ||
        lower['stripe-signature'],
    );
  }

  private signatureCandidates(signature: string) {
    return signature
      .split(',')
      .map((part) => part.trim())
      .flatMap((part) => {
        if (part.includes('=')) {
          const [, value] = part.split('=');
          return [value?.trim()].filter((candidate): candidate is string =>
            Boolean(candidate),
          );
        }
        return [part];
      });
  }

  private safeCompare(candidate: string, expected: string) {
    const left = Buffer.from(candidate, 'hex');
    const right = Buffer.from(expected, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private normalizeSubscriptionStatus(value: unknown, eventType: string) {
    const status = this.toString(value)?.trim().toLowerCase();
    if (status) return status;
    if (/deleted|canceled|cancelled/i.test(eventType)) return 'canceled';
    if (/paid|active|updated|created/i.test(eventType)) return 'active';
    return 'inactive';
  }

  private isInvoiceEvent(eventType: string, payload: BillingWebhookPayload) {
    return (
      /invoice\./i.test(eventType) ||
      Boolean(payload.invoice || payload.invoiceId) ||
      this.toRecord(this.toRecord(payload.data).object).object === 'invoice'
    );
  }

  private normalizeInvoiceStatus(value: unknown, eventType: string) {
    const status = this.toString(value)?.trim().toLowerCase();
    if (status) return status;
    if (/payment_failed|failed|voided|uncollectible/i.test(eventType))
      return 'failed';
    if (/paid|payment_succeeded/i.test(eventType)) return 'paid';
    return 'open';
  }

  private isPaidInvoiceStatus(status: string) {
    return ['paid', 'succeeded', 'payment_succeeded'].includes(status);
  }

  private isFailedInvoiceStatus(status: string) {
    return ['failed', 'payment_failed', 'past_due', 'uncollectible'].includes(
      status,
    );
  }

  private isCommercialSubscription(input: {
    plan: string;
    status: string;
    currentPeriodEnd: Date | null;
  }) {
    const activeStatus = ['active', 'trialing', 'paid'].includes(input.status);
    const periodActive =
      !input.currentPeriodEnd || input.currentPeriodEnd > new Date();
    return (
      activeStatus &&
      periodActive &&
      getKaypalPlanRank(input.plan) >= getKaypalPlanRank('STANDARD')
    );
  }

  private resolveEntitlementStatus(input: {
    status: string;
    currentPeriodEnd: Date | null;
    commercialExecutionAllowed: boolean;
  }) {
    if (input.commercialExecutionAllowed) return 'active';
    if (input.currentPeriodEnd && input.currentPeriodEnd <= new Date()) {
      return 'expired';
    }
    return input.status;
  }

  private resolveFeatures(plan: string, commercialExecutionAllowed: boolean) {
    const features = ['auth', 'app-market'];
    if (getKaypalPlanRank(plan) >= getKaypalPlanRank('STANDARD')) {
      features.push('crm', 'growth', 'local-engine');
    }
    if (commercialExecutionAllowed) {
      features.push('commercial-execution');
    }
    return features;
  }

  private requireString(value: unknown, field: string) {
    const text = this.toString(value);
    if (!text) {
      throw new BadRequestException(`计费 webhook 缺少 ${field}`);
    }
    return text;
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private toDate(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value > 1_000_000_000_000 ? value : value * 1000);
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  }

  private toInteger(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return 0;
  }

  private normalizeCurrency(value: unknown) {
    const currency = this.toString(value)?.toUpperCase();
    return currency && /^[A-Z]{3}$/.test(currency) ? currency : 'CNY';
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toJsonObject(value: unknown): Prisma.InputJsonObject {
    return this.toRecord(value) as Prisma.InputJsonObject;
  }

  private headerValue(value: string | string[] | undefined) {
    if (Array.isArray(value)) return value[0] || null;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}

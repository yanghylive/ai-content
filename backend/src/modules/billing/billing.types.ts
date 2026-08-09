import type { AuthenticatedUser } from '../auth/auth.types';

export interface BillingWebhookHeaders {
  [key: string]: string | string[] | undefined;
}

export interface BillingSubscriptionPayload {
  id?: unknown;
  subscriptionId?: unknown;
  customerId?: unknown;
  plan?: unknown;
  status?: unknown;
  currentPeriodStart?: unknown;
  currentPeriodEnd?: unknown;
  periodStart?: unknown;
  periodEnd?: unknown;
  cancelAtPeriodEnd?: unknown;
  created?: unknown;
  createdAt?: unknown;
  timestamp?: unknown;
  occurredAt?: unknown;
  metadata?: unknown;
}

export interface BillingInvoicePayload {
  id?: unknown;
  invoiceId?: unknown;
  customerId?: unknown;
  subscriptionId?: unknown;
  subscription?: unknown;
  status?: unknown;
  amountDue?: unknown;
  amountPaid?: unknown;
  amount_due?: unknown;
  amount_paid?: unknown;
  currency?: unknown;
  hostedInvoiceUrl?: unknown;
  hosted_invoice_url?: unknown;
  invoicePdfUrl?: unknown;
  invoice_pdf?: unknown;
  attemptedAt?: unknown;
  paidAt?: unknown;
  failedAt?: unknown;
  created?: unknown;
  createdAt?: unknown;
  timestamp?: unknown;
  occurredAt?: unknown;
  currentPeriodEnd?: unknown;
  periodEnd?: unknown;
  metadata?: unknown;
}

export interface BillingWebhookPayload {
  id?: unknown;
  eventId?: unknown;
  type?: unknown;
  eventType?: unknown;
  created?: unknown;
  createdAt?: unknown;
  timestamp?: unknown;
  occurredAt?: unknown;
  tenantId?: unknown;
  userId?: unknown;
  kaypalUserId?: unknown;
  customerId?: unknown;
  subscriptionId?: unknown;
  subscription?: BillingSubscriptionPayload;
  invoiceId?: unknown;
  invoice?: BillingInvoicePayload;
  data?: unknown;
  metadata?: unknown;
}

export interface BillingWebhookResult {
  provider: string;
  eventId: string;
  eventType: string;
  duplicate: boolean;
  processed: boolean;
  tenantId: string | null;
  subscriptionId: string | null;
  plan: string | null;
  status: string;
  commercialExecutionAllowed: boolean;
  message: string;
}

export interface BillingReadinessEvidence {
  configured: boolean;
  webhookSecretConfigured: boolean;
  latestEventAt: string | null;
  latestEventStatus: string | null;
  latestProvider: string | null;
  latestSubscriptionStatus: string | null;
  latestSubscriptionPlan: string | null;
  latestInvoiceStatus: string | null;
  activeSubscriptionCount: number;
  verifiedWebhookCount: number;
  processedWebhookCount: number;
  invoiceAuditCount: number;
  failedInvoiceCount: number;
  lifecycleEventCount: number;
}

export interface BillingStatus {
  tenantId: string;
  user: Pick<AuthenticatedUser, 'id' | 'email' | 'kaypalUserId'>;
  entitlement: {
    source: string;
    plan: string;
    status: string;
    commercialExecutionAllowed: boolean;
    externalSubscriptionId: string | null;
    periodEnd: string | null;
  } | null;
  latestSubscription: {
    provider: string;
    externalSubscriptionId: string;
    plan: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  latestInvoice: {
    provider: string;
    externalInvoiceId: string;
    externalSubscriptionId: string | null;
    status: string;
    amountDue: number;
    amountPaid: number;
    currency: string;
    paidAt: string | null;
    failedAt: string | null;
  } | null;
}

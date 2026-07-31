"use client";

import React from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  addToast,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { SimpleFeaturePage } from "../../agent-workbench/agent-workbench-client";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import {
  localEngineApi,
  riskPolicyApi,
  type RiskPolicy,
  type InteractionReplyRuleConfig,
  type InteractionSendMode,
} from "@/lib/api/local-engine";
import {
  authApi,
  kaypalApi,
  type AuthUser,
  type KaypalBillingSnapshot,
  type KaypalProfile,
  type KaypalSubscription,
} from "@/lib/api/auth";

function formatPlanLabel(
  value?:
    | string
    | null,
) {
  const normalized =
    String(
      value ||
        "",
    ).trim();
  if (
    !normalized
  )
    return "未返回";
  const upper =
    normalized.toUpperCase();
  const labels: Record<
    string,
    string
  > =
    {
      FREE: "免费版",
      PRO: "专业版",
      ADVANCED:
        "高级版",
      ENTERPRISE:
        "企业版",
    };
  return (
    labels[
      upper
    ] ||
    normalized
  );
}

function formatDateLabel(
  value?:
    | string
    | null,
) {
  if (
    !value
  )
    return "未返回";
  const date =
    new Date(
      value,
    );
  if (
    Number.isNaN(
      date.getTime(),
    )
  )
    return String(
      value,
    );
  return date.toLocaleDateString();
}

function asRecord(
  value: unknown,
): Record<
  string,
  unknown
> | null {
  return value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value,
    )
    ? (value as Record<
        string,
        unknown
      >)
    : null;
}

function getNestedSubscription(
  value: unknown,
): Record<
  string,
  unknown
> | null {
  const record =
    asRecord(
      value,
    );
  if (
    !record
  )
    return null;
  const subscription =
    asRecord(
      record.subscription,
    );
  if (
    subscription
  )
    return subscription;
  const data =
    asRecord(
      record.data,
    );
  return (
    asRecord(
      data?.subscription,
    ) ||
    data ||
    record
  );
}

function unwrapApiData<
  T,
>(
  value:
    | T
    | {
        data: T;
      },
): T {
  const record =
    asRecord(
      value,
    );
  return record &&
    "data" in
      record
    ? (record.data as T)
    : (value as T);
}

function getSubscriptionPlan(
  subscription: KaypalSubscription | null,
  billing: KaypalBillingSnapshot | null,
) {
  const fromSubscription =
    subscription?.plan;
  if (
    fromSubscription
  )
    return fromSubscription;
  const nested =
    getNestedSubscription(
      billing?.subscription,
    );
  const plan =
    nested?.plan;
  if (
    typeof plan ===
    "string"
  )
    return plan;
  const planRecord =
    asRecord(
      plan,
    );
  if (
    planRecord
  ) {
    return (
      String(
        planRecord.legacyId ||
          planRecord.code ||
          planRecord.name ||
          "",
      ).trim() ||
      null
    );
  }
  const subscriptionPlan =
    nested?.subscriptionPlan;
  return typeof subscriptionPlan ===
    "string"
    ? subscriptionPlan
    : null;
}

function getSubscriptionPeriodEnd(
  subscription: KaypalSubscription | null,
  billing: KaypalBillingSnapshot | null,
) {
  if (
    subscription?.periodEnd
  )
    return subscription.periodEnd;
  const nested =
    getNestedSubscription(
      billing?.subscription,
    );
  const value =
    nested?.periodEnd ||
    nested?.currentPeriodEnd ||
    nested?.subscriptionPeriodEnd;
  return typeof value ===
    "string"
    ? value
    : null;
}

function formatCredits(
  value:
    | number
    | null
    | undefined,
) {
  if (
    typeof value !==
      "number" ||
    !Number.isFinite(
      value,
    )
  )
    return "未返回";
  return new Intl.NumberFormat(
    "zh-CN",
    {
      maximumFractionDigits: 2,
    },
  ).format(
    value,
  );
}

const actionLabels: Record<string, string> = {
  "agent-confirmation": "人工确认",
  "auto-reply": "自动回复",
  "browser-control": "浏览器操作",
  "delete-account": "删除账号",
  "file-write": "写入文件",
  "group-send": "群发消息",
  publish: "内容发布",
  "retry-publish": "重试发布",
  "runtime-control": "本机服务控制",
  "schedule-enable": "启用定时任务",
  send: "发送消息",
};

function formatActionLabel(action: string) {
  return actionLabels[action] || commercialDisplayText(action.replace(/-/g, " "));
}

function formatRiskLevel(value: string) {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  if (value === "low") return "低";
  return commercialDisplayText(value);
}

function RiskPolicySection() {
  const [
    policies,
    setPolicies,
  ] =
    React.useState<
      RiskPolicy[]
    >(
      [],
    );
  const [
    currentUser,
    setCurrentUser,
  ] =
    React.useState<AuthUser | null>(
      null,
    );
  const [
    kaypalProfile,
    setKaypalProfile,
  ] =
    React.useState<KaypalProfile | null>(
      null,
    );
  const [
    kaypalSubscription,
    setKaypalSubscription,
  ] =
    React.useState<KaypalSubscription | null>(
      null,
    );
  const [
    kaypalBilling,
    setKaypalBilling,
  ] =
    React.useState<KaypalBillingSnapshot | null>(
      null,
    );
  const [
    kaypalError,
    setKaypalError,
  ] =
    React.useState<
      | string
      | null
    >(
      null,
    );
  const [
    loading,
    setLoading,
  ] =
    React.useState(
      true,
    );
  const [
    loadError,
    setLoadError,
  ] =
    React.useState<
      | string
      | null
    >(
      null,
    );
  const [
    saving,
    setSaving,
  ] =
    React.useState<
      | string
      | null
    >(
      null,
    );
  const [
    draft,
    setDraft,
  ] =
    React.useState<
      Record<
        string,
        Partial<RiskPolicy>
      >
    >(
      {},
    );
  const loadPolicies =
    React.useCallback(() =>{
      setLoading(
        true,
      );
      setLoadError(
        null,
      );
      Promise.all(
        [
          riskPolicyApi.list(),
          authApi
            .me()
            .catch(
              () =>
                null,
            ),
          kaypalApi
            .profile()
            .catch(
              (
                error,
              ) =>{
                setKaypalError(
                  toPublicError(
                    error,
                    "账号信息暂时无法读取，请稍后重试。",
                  ),
                );
                return null;
              },
            ),
          kaypalApi
            .subscription()
            .catch(
              () =>
                null,
            ),
          kaypalApi
            .billing()
            .catch(
              (
                error,
              ) =>{
                setKaypalError(
                  toPublicError(
                    error,
                    "订阅和积分暂时无法读取，请稍后重试。",
                  ),
                );
                return null;
              },
            ),
        ],
      )
        .then(
          ([
            list,
            user,
            profile,
            subscription,
            billing,
          ]) =>{
            setPolicies(
              list,
            );
            setCurrentUser(
              user,
            );
            setKaypalProfile(
              profile,
            );
            setKaypalSubscription(
              subscription,
            );
            setKaypalBilling(
              billing,
            );
            if (
              profile ||
              subscription ||
              billing
            ) {
              setKaypalError(
                null,
              );
            }
          },
        )
        .catch(
          (
            error: unknown,
          ) =>{
            setPolicies(
              [],
            );
            setLoadError(
              toPublicError(
                error,
                "风控策略暂时无法读取，请稍后重试。",
              ),
            );
          },
        )
        .finally(
          () =>
            setLoading(
              false,
            ),
        );
    }, []);

  React.useEffect(() =>{
    loadPolicies();
  }, [
    loadPolicies,
  ]);

  const updateDraft =
    (
      action: string,
      field: keyof RiskPolicy,
      value: boolean,
    ) =>{
      setDraft(
        (
          prev,
        ) => ({
          ...prev,
          [action]:
            {
              ...prev[
                action
              ],
              [field]:
                value,
            },
        }),
      );
    };

  const handleSave =
    async (
      policy: RiskPolicy,
    ) =>{
      const changes =
        draft[
          policy
            .action
        ];
      if (
        !changes
      )
        return;
      setSaving(
        policy.action,
      );
      try {
        const updated =
          await riskPolicyApi.update(
            policy.action,
            changes,
          );
        setPolicies(
          (
            prev,
          ) =>
            prev.map(
              (
                p,
              ) =>
                p.action ===
                updated.action
                  ? updated
                  : p,
            ),
        );
        setDraft(
          (
            prev,
          ) =>{
            const next =
              {
                ...prev,
              };
            delete next[
              policy
                .action
            ];
            return next;
          },
        );
        addToast(
          {
            title:
              "策略已更新",
            description:
              formatActionLabel(policy.action),
            color:
              "success",
          },
        );
      } catch (e: unknown) {
        addToast(
          {
            title:
              "更新失败",
            description:
              toPublicError(
                e,
                "风控策略未能更新，请稍后重试。",
              ),
            color:
              "danger",
          },
        );
      } finally {
        setSaving(
          null,
        );
      }
    };

  const getVal =
    (
      policy: RiskPolicy,
      field:
        | "requireConfirm"
        | "autoExecute"
        | "forbidden",
    ) =>{
      return (
        draft[
          policy
            .action
        ]?.[
          field
        ] ??
        policy[
          field
        ]
      );
    };
  if (
    loading
  ) {
    return (
      <div className="flex items-center gap-2 py-5 justify-center">
        <Spinner size="sm" />
        <span className="text-small text-default-500">
          加载风控策略...
        </span>
      </div>
    );
  }
  if (
    loadError
  ) {
    return (
      <Card className="border-small border-danger-200 bg-danger-50 shadow-sm">
        <CardBody className="gap-3">
          <div className="flex items-start gap-3">
            <Icon
              className="mt-0.5 text-danger-600"
              icon="solar:danger-triangle-linear"
              width={
                22
              }
            />
            <div className="flex-1">
              <p className="text-small font-semibold text-danger-700">
                风控策略读取失败
              </p><p className="mt-1 text-small text-danger-600">{
                  loadError
                }</p><p className="mt-1 text-tiny text-danger-500">
                发布、发送、删除、远程接管等高风险动作仍以系统实际拦截为准；请先确认登录状态、套餐权限和服务状态。
              </p>
            </div>
          </div><div>
            <Button
              color="danger"
              size="sm"
              variant="flat"
              onPress={
                loadPolicies
              }
            >
              重新读取
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-small font-semibold text-default-800">
                  自动执行策略
                </p><p className="text-tiny text-default-500 mt-1">
                  发布、删除账号、发送/草稿、Agent
                  确认、远程接管等动作默认自动执行；系统保留操作者、设备、目标和结果审计。
                </p>
              </div><div className="flex items-center gap-2">
                <Chip
                  color="success"
                  variant="flat"
                >
                  默认自动执行
                </Chip><Chip
                  color="primary"
                  variant="flat"
                >
                  所有账号可编辑
                </Chip><Chip
                  color="default"
                  variant="flat"
                >
                  保留审计
                </Chip>
              </div>
            </div>
          </div>
        </CardBody>
      </Card><Card className="border-small border-divider bg-background shadow-sm">
        <CardBody>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-small font-semibold text-default-800">
                Kaypal
                账户与额度
              </p><p className="mt-1 text-tiny text-default-500">
                这里读取登录用户绑定的
                Kaypal
                云端账号、订阅级别和积分余额；当前版本不按套餐或角色限制风控策略编辑。
              </p>
            </div><div className="flex flex-wrap gap-2">
              <Chip
                color={
                  kaypalProfile
                    ? "success"
                    : "warning"
                }
                size="sm"
                variant="flat"
              >{kaypalProfile
	                  ? "账号已更新"
	                  : "账号读取中"}</Chip><Chip
                color={
                  kaypalBilling
                    ?.balance
                    ?.balance !=
                  null
                    ? "success"
                    : "default"
                }
                size="sm"
                variant="flat"
              >{kaypalBilling
                  ?.balance
                  ?.balance !=
                null
                  ? "积分已同步"
                  : "积分未返回"}</Chip>
            </div>
          </div><div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
              <p className="text-tiny text-default-500">
                登录账号
              </p><p className="mt-1 truncate text-small font-medium text-default-900">{kaypalProfile?.email ||
                  currentUser?.email ||
                  "未返回"}</p>
            </div><div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
              <p className="text-tiny text-default-500">
                订阅级别
              </p><p className="mt-1 text-small font-medium text-default-900">{formatPlanLabel(
                  getSubscriptionPlan(
                    kaypalSubscription,
                    kaypalBilling,
                  ) ||
                    currentUser?.kaypalPlan,
                )}</p>
            </div><div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
              <p className="text-tiny text-default-500">
                可用积分
              </p><p className="mt-1 text-small font-medium text-default-900">{formatCredits(
                  kaypalBilling
                    ?.balance
                    ?.balance,
                )}</p>
            </div><div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
              <p className="text-tiny text-default-500">
                到期时间
              </p><p className="mt-1 text-small font-medium text-default-900">{formatDateLabel(
                  getSubscriptionPeriodEnd(
                    kaypalSubscription,
                    kaypalBilling,
                  ),
                )}</p>
            </div>
          </div>{kaypalError ||
          kaypalBilling
            ?.balance
            ?.unavailable ? (
            <div className="mt-3 rounded-[8px] border-small border-warning-200 bg-warning-50 px-3 py-2 text-small text-warning-700">{kaypalError ||
                toPublicError(
                  kaypalBilling?.balance?.message,
                  "订阅或积分信息暂时无法读取，请稍后重试。",
                )}</div>
          ) : null}</CardBody>
      </Card><DefaultSendModeSection />{currentUser ? (
        <Card className="border-small border-divider bg-background shadow-sm">
          <CardBody>
            <div className="flex flex-wrap items-center gap-3 text-small">
              <p className="font-semibold text-default-800">
                当前权限
              </p><Chip
                size="sm"
                variant="flat"
              >
                管理角色：
                {currentUser.kaypalRole ||
                  "无"}</Chip><Chip
                size="sm"
                variant="flat"
              >
                平台角色：
                {currentUser.kaypalPlatformRole ||
                  "无"}</Chip><Chip
                color={
                  currentUser.kaypalPlan ===
                  "FREE"
                    ? "default"
                    : "primary"
                }
                size="sm"
                variant="flat"
              >
                套餐：
                {currentUser.kaypalPlan ||
                  "FREE"}</Chip><Chip
                color="success"
                size="sm"
                variant="flat"
              >
                风控策略可编辑
              </Chip>
            </div>
          </CardBody>
        </Card>
      ) : null}
      {policies.length >
      0 ? (
        <Card className="border-small border-divider bg-background shadow-sm">
          <CardBody className="p-0">
            <Table
              aria-label="风控策略配置表"
              removeWrapper
            >
              <TableHeader>
                <TableColumn>
                  动作
                </TableColumn><TableColumn>
                  来源
                </TableColumn><TableColumn>
                  风险等级
                </TableColumn><TableColumn>
                  需确认
                </TableColumn><TableColumn>
                  自动执行
                </TableColumn><TableColumn>
                  禁止
                </TableColumn><TableColumn>
                  最低套餐
                </TableColumn><TableColumn>
                  操作
                </TableColumn>
              </TableHeader><TableBody>{policies.map(
                  (
                    policy,
                  ) => (
                    <TableRow
                      key={
                        policy.action
                      }
                    >
                      <TableCell>
                        <span className="text-small font-medium">{
                            formatActionLabel(policy.action)
                          }</span>{policy.description ? (
                          <p className="mt-1 text-tiny text-default-400">{
                              commercialDisplayText(policy.description)
                            }</p>
                        ) : null}</TableCell><TableCell>
                        <Chip
                          color={
                            policy.source ===
                            "custom"
                              ? "primary"
                              : "default"
                          }
                          size="sm"
                          variant="flat"
                        >{policy.source ===
                          "custom"
                            ? "自定义"
                            : "默认"}</Chip>
                      </TableCell><TableCell>
                        <Chip
                          color={
                            policy.riskLevel ===
                            "high"
                              ? "danger"
                              : policy.riskLevel ===
                                  "medium"
                                ? "warning"
                                : "default"
                          }
                          size="sm"
                          variant="flat"
                        >{
                            formatRiskLevel(policy.riskLevel)
                          }</Chip>
                      </TableCell><TableCell>
                        <Switch
                          isSelected={getVal(
                            policy,
                            "requireConfirm",
                          )}
                          size="sm"
                          onValueChange={(
                            v,
                          ) =>
                            updateDraft(
                              policy.action,
                              "requireConfirm",
                              v,
                            )
                          }
                        />
                      </TableCell><TableCell>
                        <Switch
                          isSelected={getVal(
                            policy,
                            "autoExecute",
                          )}
                          size="sm"
                          onValueChange={(
                            v,
                          ) =>
                            updateDraft(
                              policy.action,
                              "autoExecute",
                              v,
                            )
                          }
                        />
                      </TableCell><TableCell>
                        <Switch
                          isSelected={getVal(
                            policy,
                            "forbidden",
                          )}
                          size="sm"
                          onValueChange={(
                            v,
                          ) =>
                            updateDraft(
                              policy.action,
                              "forbidden",
                              v,
                            )
                          }
                        />
                      </TableCell><TableCell>
                        <Chip
                          size="sm"
                          variant="bordered"
                        >{policy.minPlan ||
                            "无"}</Chip>
                      </TableCell><TableCell>
                        <Button
                          isDisabled={
                            !draft[
                              policy
                                .action
                            ]
                          }
                          isLoading={
                            saving ===
                            policy.action
                          }
                          size="sm"
                          variant="flat"
                          onPress={() =>
                            handleSave(
                              policy,
                            )
                          }
                        >
                          保存
                        </Button>
                      </TableCell>
                    </TableRow>
                  ),
                )}</TableBody>
            </Table>
          </CardBody>
        </Card>
      ) : (
        <Card className="border-small border-divider bg-background shadow-sm">
          <CardBody>
            <p className="text-small text-default-400 text-center py-4">
              暂无风控策略数据
            </p>
          </CardBody>
        </Card>
      )}</div>
  );
}

export default function Page() {
  return (
    <SimpleFeaturePage
      title="权限风控"
      description="统一管理发布、发送、删除、改文件和外部提交等动作的自动执行策略。"
      icon="solar:shield-check-linear"
      capabilityKey="permission-check"
      localEngineTab="permissions"
      primaryAction={{
        label:
          "运行检查",
        href: "/local-engine?tab=permissions",
        icon: "solar:monitor-linear",
      }}
      items={[
        "默认所有动作自动执行，只有显式打开确认开关才进入待确认。",
        "系统统一保留账号、目标、内容、当前窗口和影响范围审计。",
        "失败提示统一显示动作名、影响对象、当前阶段、未执行动作、下一步和证据数。",
        "风控规则同时作用于发布中心、客户互动和本机执行流程。",
      ]}
    >
      <RiskPolicySection />
    </SimpleFeaturePage>
  );
}

/**
 * 默认发送策略：用户能选的“自动执行 / 确认后发送”开关。
 */
function DefaultSendModeSection() {
  const [
    rule,
    setRule,
  ] =
    React.useState<InteractionReplyRuleConfig | null>(
      null,
    );
  const [
    loading,
    setLoading,
  ] =
    React.useState(
      true,
    );
  const [
    saving,
    setSaving,
  ] =
    React.useState(
      false,
    );
  const [
    draft,
    setDraft,
  ] =
    React.useState<InteractionSendMode | null>(
      null,
    );

  const load =
    React.useCallback(() =>{
      setLoading(
        true,
      );
      localEngineApi
        .replyRule()
        .then(
          (
            r,
          ) =>{
            const resolved =
              unwrapApiData<InteractionReplyRuleConfig>(
                r,
              );
            setRule(
              resolved,
            );
            setDraft(
              resolved?.defaultSendMode ??
                "auto-send",
            );
          },
        )
        .catch(
          () =>{
            setRule(
              null,
            );
            setDraft(
              "auto-send",
            );
          },
        )
        .finally(
          () =>
            setLoading(
              false,
            ),
        );
    }, []);

  React.useEffect(() =>{
    load();
  }, [
    load,
  ]);

  const save =
    async () =>{
      if (
        !rule ||
        draft ===
          null
      )
        return;
      setSaving(
        true,
      );
      try {
        const updated =
          await localEngineApi.updateReplyRule(
            {
              ...rule,
              defaultSendMode:
                draft,
            },
          );
        const resolved =
          unwrapApiData<InteractionReplyRuleConfig>(
            updated,
          );
        setRule(
          resolved,
        );
        addToast(
          {
            title:
              "默认发送策略已保存",
            color:
              "success",
          },
        );
      } catch (e: unknown) {
        addToast(
          {
            title:
              "保存失败",
            description:
              toPublicError(
                e,
                "默认发送策略未能保存，请稍后重试。",
              ),
            color:
              "danger",
          },
        );
      } finally {
        setSaving(
          false,
        );
      }
    };
  const isAutoSend =
    draft ===
    "auto-send";
  const dirty =
    rule !=
      null &&
    draft !==
      rule.defaultSendMode;
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-small font-semibold text-default-800">
                默认发送策略
              </p><Chip
                size="sm"
                color={
                  isAutoSend
                    ? "success"
                    : "warning"
                }
                variant="flat"
              >{isAutoSend
                  ? "自动执行"
                  : "确认后执行"}</Chip>{dirty ? (
                <Chip
                  size="sm"
                  color="primary"
                  variant="flat"
                >
                  有改动未保存
                </Chip>
              ) : null}</div><p className="mt-1 text-tiny text-default-500">
              开启“自动执行”：高风险动作（发布
              /
              发送
              /
              删除
              /
              写文件
              /
              群发
              /
              朋友圈）直接执行，不再停下等人确认。
              关闭“确认后执行”：每个高风险动作都会进
              待确认列表，等待你确认。
            </p><p className="mt-1 text-tiny text-default-400">
              建议日常使用自动执行；遇到目标不明确、风险内容、权限缺失或你主动切换时，再进入确认后执行。
            </p>
          </div><div className="flex items-center gap-3">
            <span
              className={
                isAutoSend
                  ? "text-small text-default-500"
                  : "text-small font-semibold text-warning-600"
              }
            >
              确认后执行
            </span><Switch
              size="md"
              color="success"
              isSelected={
                isAutoSend
              }
              isDisabled={
                loading ||
                saving
              }
              onValueChange={(
                v,
              ) =>
                setDraft(
                  v
                    ? "auto-send"
                    : "approval-send",
                )
              }
            />
            <span
              className={
                isAutoSend
                  ? "text-small font-semibold text-success-600"
                  : "text-small text-default-500"
              }
            >
              自动执行
            </span><Button
              size="sm"
              color="primary"
              isDisabled={
                !dirty ||
                saving
              }
              isLoading={
                saving
              }
              onPress={
                save
              }
            >
              保存
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

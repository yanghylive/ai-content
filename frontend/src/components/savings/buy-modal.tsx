"use client";

import React, { useState } from "react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { Copy, ExternalLink, Loader2, ShieldCheck, ShoppingBag } from "lucide-react";
import { savingsApi, type OfferView } from "@/lib/api/savings";

interface BuyModalProps {
  offer: OfferView;
  onClose: () => void;
  onCopied?: (msg: string) => void;
}

/**
 * 「去购买」转化弹层：先给用户看到「到手价 + 返利 + 券」的确定性收益，
 * 确认后调用 translink 生成推广链接，再一键复制/打开 —— 打通「看到 → 下单」闭环。
 */
export function BuyModal({ offer, onClose, onCopied }: BuyModalProps) {
  const [generating, setGenerating] = useState(false);
  const [promoUrl, setPromoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await savingsApi.translink({
        platformCode: offer.platformCode,
        itemId: offer.itemId,
        activityId: offer.itemId,
      });
      setPromoUrl(result.promoUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "推广链接生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!promoUrl) return;
    try {
      await navigator.clipboard.writeText(promoUrl);
      onCopied?.("✅ 链接已复制，去原平台打开下单即可返利");
    } catch {
      onCopied?.("❌ 复制失败，请手动选择复制");
    }
  };

  return (
    <Modal isOpen onOpenChange={onClose} placement="center" size="sm">
      <ModalContent>
        {(onCloseModal) => (
          <>
            <ModalHeader className="flex items-center gap-2 text-base font-bold">
              <ShoppingBag className="h-5 w-5 text-orange-500 dark:text-orange-400" />
              去购买 · 省多少一目了然
            </ModalHeader>
            <ModalBody className="pt-0">
              <div className="rounded-xl border border-default-200 bg-default-50 p-3 dark:border-default-800 dark:bg-default-100/5">
                <div className="line-clamp-2 text-[13px] font-semibold text-foreground">{offer.title}</div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-[15px] font-extrabold text-foreground">
                    <span className="text-[11px] font-semibold text-default-500">到手价 ¥</span>
                    {offer.payPrice}
                  </span>
                  <span className="text-[15px] font-extrabold text-orange-500 dark:text-orange-400">返 ¥{offer.estRebate}</span>
                  <span className="text-[12px] text-default-500">净成本 ¥{offer.estNetCost}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {offer.couponAmount > 0 && (
                    <span className="rounded bg-red-50 px-1.5 py-px text-[11px] font-bold text-red-600 dark:bg-red-500/10 dark:text-red-300">
                      ¥{offer.couponAmount}优惠券
                    </span>
                  )}
                  {offer.commissionRate > 0 && (
                    <span className="rounded bg-emerald-50 px-1.5 py-px text-[11px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                      佣金 {offer.commissionRate}%
                    </span>
                  )}
                </div>
              </div>

              {promoUrl ? (
                <div className="mt-1">
                  <div className="flex items-start gap-2 rounded-lg border border-default-200 bg-default-50 p-2.5 dark:border-default-800 dark:bg-default-100/5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 break-all font-mono text-[11px] leading-5 text-default-600 dark:text-default-400">
                      {promoUrl}
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-default-500">
                    复制下方口令/链接，回原平台打开并下单，返利将自动追踪入账
                  </p>
                </div>
              ) : error ? (
                <div className="mt-1 rounded-lg bg-red-50 p-2.5 text-[12px] font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300">
                  {error}
                </div>
              ) : null}

              <div className="mt-1 flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-2 text-[11px] text-orange-700 dark:bg-orange-500/10 dark:text-orange-300">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                返利现金 1:1 抵扣生图/生视频费用，本来就要买，顺手省钱
              </div>
            </ModalBody>
            <ModalFooter className="pt-1">
              {promoUrl ? (
                <Button
                  fullWidth
                  color="primary"
                  startContent={<Copy className="h-4 w-4" />}
                  onPress={handleCopy}
                >
                  复制推广链接
                </Button>
              ) : (
                <div className="flex w-full gap-2">
                  <Button variant="flat" onPress={onCloseModal} className="flex-1">
                    先看看
                  </Button>
                  <Button
                    color="primary"
                    className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500"
                    isLoading={generating}
                    startContent={!generating ? <ExternalLink className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                    onPress={handleGenerate}
                  >
                    生成购买链接
                  </Button>
                </div>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

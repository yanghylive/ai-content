"use client";

import Link from "next/link";
import { Button, Card, CardBody, Chip } from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";

export default function VideoWorkshopPage() {
    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-10">
            <header className="rounded-[10px] border-small border-white/10 bg-background/60 p-5 shadow-sm backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon icon="solar:video-frame-bold-duotone" width={22} />
                    </div>
                    <div>
                        <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">视频工坊</h2>
                        <p className="mt-1 text-small text-default-500">开发中</p>
                    </div>
                </div>
            </header>

            <Card className="border-small border-white/10 bg-background/60 shadow-medium backdrop-blur-md">
                <CardBody className="flex min-h-[280px] flex-col items-center justify-center gap-5 text-center">
                    <Chip color="warning" variant="flat">开发中</Chip>
                    <div className="flex flex-col gap-2">
                        <h3 className="text-lg font-semibold text-default-900">视频工坊暂未开放</h3>
                        <p className="max-w-lg text-small text-default-500">
                            当前入口已从运行检查页独立出来，后续视频生产能力接好后再开放使用。
                        </p>
                    </div>
                    <Button as={Link} color="primary" href="/" startContent={<Icon icon="solar:home-2-linear" />}>
                        返回总览
                    </Button>
                </CardBody>
            </Card>
        </div>
    );
}

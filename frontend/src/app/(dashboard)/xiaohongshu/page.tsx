import { ContentLibraryPage } from "../components/content-library-page";

export default function XiaohongshuPage() {
    return (
        <ContentLibraryPage
            contentType="xiaohongshu"
            title="小红书笔记"
            description="查看基于选题自动生成的小红书笔记草稿，支持预览、编辑与继续打磨。"
            searchPlaceholder="搜索小红书笔记..."
            totalLabel="总共 {count} 篇笔记"
            emptyLabel="目前还没有小红书笔记记录"
            deleteLabel="删除笔记"
            publishLabel="分发笔记"
            previewTitle="小红书笔记预览"
            publishModalSubject="笔记"
            allowPublish={false}
            allowEdit={false}
        />
    );
}

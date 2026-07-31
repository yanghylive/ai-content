import { ContentLibraryPage } from "../components/content-library-page";

export default function ArticlesPage() {
    return (
        <ContentLibraryPage
            contentType="article"
            title="我的文章"
            description="自动生成并整理的图文内容库，可预览、发布或分发到各个渠道。"
            searchPlaceholder="搜索我的文章..."
            totalLabel="总共 {count} 篇文章"
            emptyLabel="目前还没有文章记录"
            deleteLabel="删除文章"
            publishLabel="一键发布分发"
            previewTitle="HTML 文章预览"
            publishModalSubject="文章"
        />
    );
}

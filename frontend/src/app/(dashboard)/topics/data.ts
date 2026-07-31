// 前端显示用的类型定义与字段映射
import { Topic as ApiTopic } from '@/lib/api/topics';
import { commercialDisplayText } from '@/lib/commercial-display-text';

export type TopicStatus = "pending" | "generating" | "completed";

export type TopicScore = {
    audienceFit: number;
    emotionalValue: number;
    simplificationPotential: number;
    networkVolume: number;
    contentValue: number;
};

// 前端显示用的 Topic 类型（与 TopicCard 组件字段对应）
export type Topic = {
    id: string;
    title: string;
    sourceType: string;
    score: number;
    details: TopicScore;
    summary: string;
    reasoning: string;
    keywords: string[];
    searchQueries: string[];
    createDate: string;
    status: TopicStatus;
    isPublished?: boolean;
};

// 空评分详情，用于未评估的选题
const emptyScore: TopicScore = { audienceFit: 0, emotionalValue: 0, simplificationPotential: 0, networkVolume: 0, contentValue: 0 };

// 将后端 API 返回的 Topic 映射为前端显示用的 Topic
export function mapApiTopic(apiTopic: ApiTopic): Topic {
    return {
        id: apiTopic.id,
        title: commercialDisplayText(apiTopic.title),
        sourceType: commercialDisplayText(apiTopic.sourceType),
        score: apiTopic.aiScore ?? 0,
        details: apiTopic.scoreDetails ?? emptyScore,
        summary: commercialDisplayText(apiTopic.summary ?? ''),
        reasoning: commercialDisplayText(apiTopic.reasoning ?? ''),
        keywords: (apiTopic.keywords ?? []).map((item) => commercialDisplayText(item)),
        searchQueries: (apiTopic.searchQueries ?? []).map((item) => commercialDisplayText(item)),
        createDate: apiTopic.createdAt,
        status: apiTopic.status,
        isPublished: apiTopic.isPublished,
    };
}

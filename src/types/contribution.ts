/**
 * 翻译贡献项类型
 */
export interface ContributionItem {
    /** 贡献项类型 */
    type: 'identifier' | 'comment';
    
    /** 原始文本 */
    original: string;
    
    /** 翻译后文本 */
    translation: string;
    
    /** 目标语言 */
    language: string;
    
    /** 时间戳 */
    timestamp: string;
    
    /** 项目名称（可选，根据隐私设置可能不包含） */
    project?: string;
    
    /** 源文件类型（有助于上下文理解） */
    sourceLanguage?: string;
}

/**
 * 翻译贡献请求
 */
export interface ContributionRequest {
    /** 贡献项列表 */
    items: ContributionItem[];
    
    /** 贡献者 */
    contributor: string;
    
    /** 客户端版本 */
    client_version: string;
    
    /** 会话ID (可选) */
    session_id?: string;
}

/**
 * 翻译贡献响应
 */
export interface ContributionResponse {
    /** 是否成功 */
    success: boolean;
    
    /** 服务器消息 */
    message: string;
    
    /** 成功处理的项数 */
    processed_count: number;
    
    /** 贡献者统计 */
    contributor_stats?: {
        total_contributions: number;
        rank?: number;
        contribution_score: number;
    }
}

/**
 * 贡献统计信息
 */
export interface ContributionStats {
    /** 本地队列中的项目数 */
    queue_size: number;
    
    /** 已提交的项目数 */
    submitted_count: number;
    
    /** 上次提交时间 */
    last_submitted?: string;
    
    /** 从服务器获取的贡献者统计 */
    contributor_stats?: {
        total_contributions: number;
        rank?: number;
        contribution_score: number;
    }
}

/**
 * 自动提交隐私级别
 */
export enum ContributionPrivacyLevel {
    /** 提交所有翻译 */
    ALL = 'all',
    
    /** 仅提交通用术语（排除项目特定词汇） */
    GENERAL_ONLY = 'general_only',
    
    /** 最小化提交（仅提交最基本的编程术语） */
    MINIMAL = 'minimal'
} 
// 所有共享的接口和类型定义
import * as vscode from 'vscode';
export * from './contribution';

/**
 * 词汇表条目类型
 */
export type VocabularyEntryType = 'identifier' | 'comment' | 'string_literal' | string; // 允许未来扩展其他类型

/**
 * 词汇表条目接口
 */
export interface VocabularyEntry {
    original: string;             // 原始标识符或注释
    translated: string;           // 翻译后的文本
    type: VocabularyEntryType;    // 条目类型
    source?: string;              // 词条来源，例如: 'system', 'user', 'llm'
}

/**
 * 主要词汇表接口，包含系统和用户定义的词汇
 */
export interface Vocabulary {
    target_language: string; // 词汇表的目标语言，例如 "zh-CN"
    meta: {
        name: string;        // 词汇表名称
        version: string;     // 词汇表版本
        description: string; // 词汇表描述
    };
    entries: VocabularyEntry[]; // 核心数据：所有词汇条目

    // 注意：以下字段已废弃或仅用于从旧格式迁移。
    // 运行时逻辑应仅依赖 'entries'。
    // system_vocabulary?: { [key: string]: { [lang: string]: string } };
    // user_defined_identifiers?: { [key: string]: { [lang: string]: string } };
    // user_defined_comments?: { [key: string]: { [lang: string]: string } };
}

/**
 * 临时词汇表接口，用于存储从文件中提取的待翻译项
 */
export interface TempVocabulary {
    new_identifiers: string[];     // 新发现的标识符
    translated_map?: { [original: string]: string }; // 新增：缓存未合并的翻译结果
    // translated_identifiers: {      // 已翻译的标识符 (此字段已废弃)
    //     [key: string]: {
    //         [lang: string]: string;
    //     }
    // };
    // translated_comments: {         // 已翻译的注释 (此字段已废弃)
    //     [key: string]: {
    //         [lang: string]: string;
    //     }
    // };
}

/**
 * LLM翻译请求接口
 */
export interface TranslationRequest {
    items: string[];               // 待翻译的项（标识符或注释）
    sourceLanguage: string;        // 源语言
    targetLanguage: string;        // 目标语言
    type: 'identifier' | 'comment'; // 翻译项类型
    documentUri?: string;          // 文档URI，用于提供上下文
    documentLanguage?: string;     // 文档语言，用于提供上下文
}

/**
 * 翻译质量评估接口
 */
export interface TranslationQuality {
    score: number;                // 总体质量得分（0-1）
    genuinelyTranslatedCount: number; // 真正被翻译的条目数（原文与译文不同）
    totalCount: number;           // 总条目数
    issues: {                     // 翻译中发现的问题
        original: string;         // 原文
        translated: string;       // 译文
        issue: string;            // 问题描述
    }[];
}

/**
 * LLM翻译响应接口
 */
export interface TranslationResponse {
    translations: {
        original: string;          // 原始文本
        translated: string;        // 翻译后的文本
    }[];
    quality?: TranslationQuality;  // 翻译质量评估
}

/**
 * 提取结果接口
 */
export interface ExtractionResult {
    newIdentifiers: string[];
}

/**
 * 全局扩展上下文接口
 */
export interface ExtensionContext {
    context: vscode.ExtensionContext;
    vocabulary: Vocabulary | null; // 当前加载的词汇表
    tempVocabulary: TempVocabulary | null;
}

/**
 * 标识符类型
 */
export type IdentifierType = 'original' | 'split' | 'vocabulary_match'; // 新增 'vocabulary_match' 类型，表示该标识符直接从词汇表匹配获得

/**
 * 词汇表存储位置枚举
 */
export enum VocabularyStorageLocation {
    EXTENSION = 'extension',
    GLOBAL = 'global',
    PROJECT = 'project'
} 
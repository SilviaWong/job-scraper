const assert = require('assert');

// 模拟猎聘去重与技能标签提取逻辑测试
const jobTitle = "Java开发（恒生估值系统）";
const salary = "19-26k·20薪";
const workLocation = "上海-浦东新区";
const workExp = "5-10年";
const eduReq = "本科";

const excludeSet = new Set([
    jobTitle,
    salary,
    workLocation,
    workExp,
    eduReq,
    '招1人', '招若干人', '招人', '今日更新', '前更新', '更新', '招聘中', '猎聘'
]);

// 模拟原先混乱提取到的 raw 技能标签数组（包含重复标题、薪资、状态词等）
const rawCandidates = [
    "Java开发（恒生估值系统）",
    "Java开发（恒生估值系统）",
    "19-26k·20薪",
    "招1人",
    "今日更新",
    "恒生估值系统",
    "Oracle",
    "SpringCloud",
    "Vue",
    "恒生估值系统"
];

const skillSet = new Set();
rawCandidates.forEach(txt => {
    if (!txt || excludeSet.has(txt)) return;
    if (/\d+[-~]\d+[kK]|\d+薪/.test(txt)) return;
    if (/\d+年|应届|专科|大专|本科|硕士|博士|招\d+人|更新/.test(txt)) return;
    skillSet.add(txt);
});

const cleanedSkills = Array.from(skillSet).join(',');
console.log("优化后清洗去重后的技能标签:", cleanedSkills);

assert.strictEqual(cleanedSkills, "恒生估值系统,Oracle,SpringCloud,Vue", "技能标签清洗与去重完全正确！");
assert.ok(!cleanedSkills.includes("Java开发"), "已成功排除重复的职位名称");
assert.ok(!cleanedSkills.includes("19-26k"), "已成功排除薪资文本");

// 验证 jobDetail 与 jobDetailJson 去重后，job_normalizer 能否正常消费
const { normalizeJob } = require('../libs/job_normalizer.js');
const mockRow = {
    '职位ID': '77946249',
    '平台': 'liepin',
    '数据来源': 'liepin_single_details',
    '职位名称': jobTitle,
    '招聘状态': '招聘中',
    '薪资待遇': salary,
    '工作地点': workLocation,
    '工作经验': workExp,
    '学历要求': eduReq,
    '职位描述': '工作职责：...',
    '技能标签': cleanedSkills,
    'HR姓名': '李先生',
    'HR职位': '管理顾问',
    'HR活跃度': '2026-08-30',
    'HR所属公司': '诚聘人力资源（宁夏）有限公司',
    '公司名称': '某基金/证券/期货上市公司',
    '公司全称': '某基金/证券/期货上市公司',
    '公司行业': '基金/证券/期货',
    '公司ID': '45147',
    '详细完整地址': '上海-浦东新区',
    '页面更新时间': '2026-08-30',
    '最后刷新时间': '2026-08-30T18:37:31',
    '抓取时间': '8/30/2026, 9:36:10 PM',
    'jobDetail': {
        title: jobTitle,
        description: '工作职责：...',
        hiringOrganization: {
            name: '某基金/证券/期货上市公司',
            sameAs: 'https://www.liepin.com/company/45147/'
        }
    }
    // 注意：没有 jobDetailJson 冗余字段！
};

const normalized = normalizeJob(mockRow, 'liepin');
assert.strictEqual(normalized['职位ID'], '77946249');
assert.strictEqual(normalized['技能标签'], '恒生估值系统,Oracle,SpringCloud,Vue');
assert.strictEqual(normalized['HR所属公司'], '诚聘人力资源（宁夏）有限公司');
assert.strictEqual(normalized['公司名称'], '某基金/证券/期货上市公司');
assert.ok(normalized['原始详情JSON'].length > 0, "即使没有 jobDetailJson，原始详情JSON 依然正常生成！");

console.log("✅ 所有测试用例均验证通过！");

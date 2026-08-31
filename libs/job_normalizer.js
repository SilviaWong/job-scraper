(function (root) {
    function normalizeJob(job, source, context = {}) {
        let mapped = _normalizeJob(job, source, context);
        if (mapped) {
            let id = mapped['职位ID'] || (mapped['公司全称'] + '|||' + mapped['职位名称']);
            let userJobTags = context.userJobTags || root.userJobTags || {};
            let tagInfo = userJobTags[id] ? userJobTags[id] : { tags: [], isHidden: false };
            mapped['人工标签'] = tagInfo.tags || [];
            mapped['是否隐藏'] = tagInfo.isHidden || false;
        }
        return mapped;
    }

    function _normalizeJob(job, source, context = {}) {
        const cleanStr = (s) => s ? String(s).replace(/\s+/g, ' ').trim() : '';
        const cleanMultiLineStr = (s) => s ? String(s).replace(/\r\n/g, '\n').trim() : '';
        const formatActiveTime = (desc) => {
            let activeTime = cleanStr(desc);
            if (activeTime === '刚刚活跃' || activeTime === '今日活跃' || activeTime === '在线') {
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const dd = String(today.getDate()).padStart(2, '0');
                activeTime = `${yyyy}-${mm}-${dd}`;
            }
            return activeTime;
        };

        if (source === 'boss' || source === 'boss-data') {
            const isNewListStructure = !!job.jobDetail;
            const detailJson = job.jobDetail || job;
            const data = detailJson.zpData || detailJson.data || detailJson;
            const jobInfo = data.jobInfo || {};
            const boss = data.bossInfo || {};
            const comp = data.brandComInfo || {};

            let proxyTags = [];
            if (jobInfo.proxyJob === 1 || job.proxyJob === 1 || jobInfo.proxyType === 1 || job.proxyType === 1) {
                proxyTags.push('猎头/代招');
            }

            return {
                '平台': 'Boss直聘',
                '岗位类型_外包猎头': proxyTags.join(','),
                '职位ID': cleanStr(jobInfo.encryptId) || job.encryptJobId || job['职位ID'] || '',
                '职位名称': cleanStr(jobInfo.jobName) || job.jobName || job['职位名称'] || '',
                '工作地点': [job.cityName, job.areaDistrict, job.businessDistrict].filter(Boolean).join('·') || cleanStr(jobInfo.locationName) || job['工作地点'] || '',
                '详细地址': cleanStr(jobInfo.address) || job.areaDistrict || job['详细地址'] || '',
                '薪资待遇': cleanStr(jobInfo.salaryDesc) || job.salaryDesc || job['薪资待遇'] || '',
                '工作经验': cleanStr(jobInfo.experienceName) || job.jobExperience || job['工作经验'] || '',
                '学历要求': cleanStr(jobInfo.degreeName) || job.jobDegree || job['学历要求'] || '',
                '职位描述': cleanMultiLineStr(jobInfo.postDescription) || job['职位描述'] || '',
                '技能标签': cleanStr(jobInfo.showSkills) || (job.skills ? job.skills.join(',') : '') || job['技能标签'] || '',
                'HR_ID': cleanStr(jobInfo.encryptUserId) || job.encryptBossId || job['HR_ID'] || '',
                'HR姓名': cleanStr(boss.name) || job.bossName || job['HR姓名'] || '',
                'HR职位': cleanStr(boss.title) || job.bossTitle || job['HR职位'] || '',
                'HR活跃度': formatActiveTime(boss.activeTimeDesc) || (job.bossOnline ? '在线' : '') || job['HR活跃度'] || '',
                'HR所属公司': cleanStr(boss.brandName) || job['HR所属公司'] || '',
                '公司名称': job['_fetched_companyFullName'] || cleanStr(comp.brandName) || job.brandName || job['公司名称'] || '',
                '公司行业': cleanStr(comp.industryName) || job.brandIndustry || job['公司行业'] || '',
                '公司规模': cleanStr(comp.scaleName) || job.brandScaleName || job['公司规模'] || '',
                '融资阶段': cleanStr(comp.stageName) || job.brandStageName || job['融资阶段'] || '',
                '公司福利': cleanStr(comp.labels) || job['公司福利'] || '',
                '公司全称': job['_fetched_companyFullName'] || job['公司全称'] || cleanStr(comp.brandName) || job.brandName || '',
                '详细完整地址': job['_fetched_fullAddress'] || job['详细完整地址'] || '',
                '页面更新时间': job['_fetched_updateTime'] || job['页面更新时间'] || '',
                '招聘状态': job['_fetched_jobStatus'] || job['招聘状态'] || '',
                '创建时间': job['创建时间'] || '',
                '更新时间': job['更新时间'] || '',
                '原始详情JSON': job.jobDetail ? JSON.stringify(job.jobDetail) : (job.zpData ? JSON.stringify(job) : (job['原始详情JSON'] || '')),
                '原始列表JSON': isNewListStructure ? JSON.stringify({ ...job, jobDetail: undefined }) : '',
                '源数据': job
            };
        } else if (source === '51job' || source === '51job-data') {
            return {
                '平台': job['平台'] || '51job',
                '职位ID': job.jobId || job['职位ID'] || '',
                '职位名称': job.jobName || job.jobTitle || job['职位名称'] || '',
                '工作地点': job.jobAreaString || job.jobArea || job['工作地点'] || '',
                '薪资待遇': job.provideSalaryString || job.jobSalary || job['薪资待遇'] || '',
                '工作经验': job.workYearString || job.jobYear || job['工作经验'] || '',
                '学历要求': job.degreeString || job.jobDegree || job['学历要求'] || '',
                '职位描述': job.jobDescribe || job['职位描述'] || '',
                '技能标签': job._detail_jobTags || (job.jobTags ? job.jobTags.join(',') : '') || job['技能标签'] || '',
                '详细工作地址': job._detail_address || job.jobAreaLevelDetail?.fullAddress || job['详细工作地址'] || '',
                'HR姓名': job.hrName || job['HR姓名'] || '',
                'HR_ID': job.hrUid || job['HR_ID'] || '',
                'HR职位': job.hrPosition || job['HR职位'] || '',
                'HR活跃度': job.hrActive || job['HR活跃度'] || '',
                '公司名称': job.companyName || job['公司名称'] || '',
                '公司全称': job.fullCompanyName || job['公司全称'] || '',
                '公司行业': job.companyIndustryType1Str || job.coIndustryText || job['公司行业'] || '',
                '公司规模': job.companySizeString || job['公司规模'] || '',
                '融资阶段': job.companyTypeString || job['融资阶段'] || '',
                '公司福利': (job.jobWelfareCodeDataList ? job.jobWelfareCodeDataList.map(w => w.chineseTitle).join(',') : '') || (job.companyTags ? job.companyTags.join(',') : '') || job['公司福利'] || '',
                '发布时间': job.issueDateString || job['发布时间'] || '',
                '更新时间': job.updateDateTime || job['更新时间'] || '',
                '首次创建时间': job['创建时间'] || '',
                '创建时间': job['创建时间'] || '',
                '页面更新时间': job.updateDateTime || job['页面更新时间'] || '',
                '更新时间 (51job)': job.updateDateTime || job['更新时间 (51job)'] || '',
                '城市拼音': job.hrefAreaPinYin || job['城市拼音'] || '',
                '抓取源URL': job.jobUrl || job.jobHref || job['抓取源URL'] || '',
                '源数据': job
            };
        } else if (source === 'liepin' || source === 'liepin-data') {
            const rawJob = job.job || job;
            const rawComp = job.comp || job;
            const rawRecruiter = job.recruiter || job;
            const detail = job.jobDetail || job.jobDetailJson || {};
            const domData = detail.supplementalDomData || {};

            let recruiterInfo = domData.recruiterInfo || '';
            let proxyTags = [];
            let proxyCompany = '';
            if (rawJob.jobKind === "1" || job.jobKind === "1" || job.jobKind === 1 || rawJob.jobKind === 1) {
                proxyTags.push('猎头/代招');
                if (Array.isArray(recruiterInfo) && recruiterInfo.length >= 3) {
                    proxyCompany = recruiterInfo[2].replace(/^·\s*/, '').trim();
                }
            }
            if (Array.isArray(recruiterInfo)) {
                recruiterInfo = recruiterInfo.join(' | ');
            }

            let jobDescription = detail.description ? detail.description.replace(/\r\n/g, '\n').trim() : (job['职位描述'] || '');
            let additionalBlocks = domData.additionalBlocks || [];
            if (Array.isArray(additionalBlocks) && additionalBlocks.length > 0) {
                additionalBlocks.forEach(block => {
                    if (block.title && Array.isArray(block.content) && block.content.length > 0) {
                        jobDescription += `\n\n【${block.title}】\n` + block.content.join('\n');
                    }
                });
            }

            return {
                '平台': job['平台'] || 'Liepin',
                '岗位类型_外包猎头': job['岗位类型_外包猎头'] || proxyTags.join(','),
                '职位ID': rawJob.jobId || job['职位ID'] || '',
                '职位名称': detail.title || rawJob.title || job['职位名称'] || '',
                '工作地点': (detail.jobLocation && detail.jobLocation.address && detail.jobLocation.address.addressLocality) || rawJob.dq || job['工作地点'] || '',
                '详细地址': (detail.jobLocation && detail.jobLocation.address && detail.jobLocation.address.streetAddress) || job['详细完整地址'] || job['详细地址'] || rawJob.dq || '',
                '薪资待遇': rawJob.salary || job['薪资待遇'] || (detail.baseSalary ? String(detail.baseSalary) : ''),
                '工作经验': detail.experienceRequirements || rawJob.requireWorkYears || job['工作经验'] || '',
                '学历要求': detail.educationRequirements || rawJob.requireEduLevel || job['学历要求'] || '',
                '职位描述': jobDescription,
                '公司福利': domData.welfareTags || job['公司福利'] || '',
                '技能标签': job['技能标签'] || ((rawJob.labels && rawJob.labels.length > 0) ? rawJob.labels.join(',') : ''),
                'HR_ID': job['HR_ID'] || rawRecruiter.recruiterId || rawRecruiter.imId || '',
                'HR姓名': rawRecruiter.recruiterName || job['HR姓名'] || '',
                'HR职位': rawRecruiter.recruiterTitle || job['HR职位'] || '',
                'HR活跃度': rawRecruiter.imShowText || job['HR活跃度'] || recruiterInfo || '',
                'HR所属公司': job['HR所属公司'] || proxyCompany || rawComp.fullCompanyName || (detail.hiringOrganization && detail.hiringOrganization.name) || rawComp.compName || '',
                '公司名称': job['_fetched_companyFullName'] || rawComp.compName || job['公司名称'] || (detail.hiringOrganization && detail.hiringOrganization.name) || '',
                '公司全称': job['_fetched_companyFullName'] || job['公司全称'] || rawComp.fullCompanyName || rawComp.compName || (detail.hiringOrganization && detail.hiringOrganization.name) || '',
                '公司行业': detail.industry || rawComp.compIndustry || job['公司行业'] || '',
                '公司规模': rawComp.compScale || job['公司规模'] || '',
                '融资阶段': rawComp.compStage || job['融资阶段'] || '',
                '发布时间': domData.cambrianPubDate || detail.datePosted || rawJob.pubTime || job['发布时间(JSON)'] || job['发布时间'] || '',
                '页面更新时间': domData.cambrianUpDate || rawJob.refreshTime || job['更新时间(JSON)'] || job['页面更新时间'] || '',
                '页面显示更新时间': domData.domUpdateTime || job['页面显示更新时间'] || '',
                '企业行业': (domData.companyExtraInfo && domData.companyExtraInfo['企业行业']) || job['企业行业'] || '',
                '注册时间': (domData.companyExtraInfo && domData.companyExtraInfo['注册时间']) || job['注册时间'] || '',
                '注册资本': (domData.companyExtraInfo && domData.companyExtraInfo['注册资本']) || job['注册资本'] || '',
                '经营期限': (domData.companyExtraInfo && domData.companyExtraInfo['经营期限']) || job['经营期限'] || '',
                '经营范围': (domData.companyExtraInfo && domData.companyExtraInfo['经营范围']) || job['经营范围'] || '',
                '职位链接': rawJob.link ? rawJob.link.split('?')[0] : (job.jobLink || job['职位链接'] || detail.url || ''),
                '更新时间': job['更新时间'] || '',
                '创建时间': job['创建时间'] || '',
                '原始详情JSON': (job.jobDetail || job.jobDetailJson) ? JSON.stringify(job.jobDetail || job.jobDetailJson) : '',
                '源数据': job
            };
        } else if (source === 'zhilian' || source === 'zhilian-data') {
            let mappedJob = { ...job };

            // 直接读取可能嵌套的字段 (兼容 v1 的 jobDetail 和 v2 的 jobDetailData)
            const jobDetailData = job.jobDetail || job.jobDetailData || {};
            // v1 常在 detailedPosition，v2 常在 position
            const detailedPosition = jobDetailData.detailedPosition || jobDetailData.position || {};
            const detailedCompany = jobDetailData.detailedCompany || {};
            const base = detailedPosition.base || {};
            const workLocation = detailedPosition.workLocation || {};
            const desc = detailedPosition.desc || {};
            const date = detailedPosition.date || {};
            const staff = detailedPosition.staff || jobDetailData.staff || {};
            const featureServer = detailedPosition.featureServer || jobDetailData.featureServer || {};
            const companyProxy = detailedPosition.companyProxy || jobDetailData.companyProxy || {};

            // 商业标签（劳务派遣、代招等）
            let positionCommercialLabel = jobDetailData.position?.other?.positionCommercialLabel || jobDetailData.other?.positionCommercialLabel || job.positionCommercialLabel || [];
            let proxyTypeArr = positionCommercialLabel.map(v => v?.typeName).filter(Boolean);
            let proxyType = proxyTypeArr.join(',') || '';

            let jobNameStr = job['职位名称'] || job.list_jobName || detailedPosition.name || base.positionName || '';
            let descStr = detailedPosition.jobDesc || desc.description || '';
            if (jobNameStr.includes('外包') || descStr.includes('外包') || descStr.includes('非外包') === false && (descStr.includes('外包岗位') || descStr.includes('外包性质'))) {
                if (!proxyType.includes('外包') && !descStr.includes('非外包') && !descStr.includes('不外包')) {
                    proxyType = proxyType ? proxyType + ',外包' : '外包';
                }
            }
            if (jobNameStr.includes('猎头') || descStr.includes('猎头')) {
                if (!proxyType.includes('猎头')) {
                    proxyType = proxyType ? proxyType + ',猎头' : '猎头';
                }
            }

            // 基础字段提取
            let jobId = job['职位ID'] || base.positionId || job.number;
            let zhilianEnrichmentCache = context.zhilianEnrichmentCache || root.zhilianEnrichmentCache || {};
            let cached = (zhilianEnrichmentCache[jobId]) ? zhilianEnrichmentCache[jobId] : null;
            let userJobTags = context.userJobTags || root.userJobTags || {};
            let userTagInfo = (userJobTags[jobId]) ? userJobTags[jobId] : { tags: [], isHidden: false };

            const extracted = {
                '职位名称': job['职位名称'] || job.list_jobName || detailedPosition.name || base.positionName,
                '职位链接': job['干净链接'] || job.list_url,
                '职位ID': jobId,
                '人工标签': userTagInfo.tags || [],
                '是否隐藏': userTagInfo.isHidden || false,
                '接口返回_职位名称': detailedPosition.name || base.positionName,
                '薪资待遇': detailedPosition.salary || base.salary,
                '学历要求': detailedPosition.education || base.education,
                '工作经验': detailedPosition.workingExp || base.positionWorkingExp,
                '工作类型': detailedPosition.workType || base.workType,
                '工作城市': '',
                '详细工作地址': jobDetailData.workAddress || detailedPosition.workAddress || workLocation.workAddress,
                '经度': detailedPosition.longitude || workLocation.longitude,
                '纬度': detailedPosition.latitude || workLocation.latitude,
                '公司全称': detailedCompany.companyName || job.companyName || '',
                '公司规模': detailedCompany.companySize || job.companySize || '',
                '行业名称': detailedCompany.industryNameLevel || detailedCompany.industryLevel || job.industryName || '',
                '融资阶段': detailedCompany.financingStageName || job.financingStage?.name || '',
                '代理用人公司': companyProxy.companyName,
                '岗位类型_外包猎头': proxyType,
                '职位描述': detailedPosition.jobDesc || desc.description,
                '首次创建时间': (cached && cached.firstPublishTime) || date.firstPublishTime || job.firstPublishTime || job['创建时间'] || '',
                '页面更新时间': (cached && cached.publishTime) || date.positionUpdateTimeText || job.publishTime || '',
                'HR姓名': staff.staffName,
                'HR职位': staff.hrJob,
                'HR平均首响(7天)': featureServer.staffAvgFirstResponseTime7d,
                'HR平均处理(30天)': featureServer.staffAvgHandleResumeTime30d,
                '抓取时间': job['抓取时间'],
                '创建时间': job['创建时间']
            };

            // 数组/对象字段提取
            // 技能标签提取：1. jobDetail.detailedPosition.skillLabel 2. zhilian_enrichment_cache(jobSkillTags) 3. desc.labels
            let skillLabelArr = detailedPosition.skillLabel || [];
            let extractedSkills = skillLabelArr.map(v => v?.value || v?.name || (typeof v === 'string' ? v : '')).filter(Boolean).join(',');

            if (!extractedSkills) {
                let jobSkillTags = (cached && cached.jobSkillTags) ? cached.jobSkillTags : (job.jobSkillTags || []);
                extractedSkills = jobSkillTags.map(v => v?.name || v?.value || (typeof v === 'string' ? v : '')).filter(Boolean).join(',');
            }

            if (!extractedSkills) {
                let labels = desc.labels || [];
                extractedSkills = labels.map(v => v?.typeName || v?.name || v?.itemValue || (typeof v === 'string' ? v : JSON.stringify(v))).filter(Boolean).join(',');
            }
            extracted['技能要求标签'] = extractedSkills;

            let commercialLabel = job.commercialLabel || [];
            extracted['商业标签'] = commercialLabel.map(v => v?.typeName || v?.name || v?.itemValue || (typeof v === 'string' ? v : JSON.stringify(v))).filter(Boolean).join(',');

            let activityLevel = staff.activityLevel || [];
            extracted['HR活跃状态'] = activityLevel.map(v => v?.itemValue || v).filter(Boolean).join(',');

            // 公司福利提取
            let jobKeyword = (cached && cached.jobKeyword) ? cached.jobKeyword : job.jobKeyword;
            let keywordsArr = (jobKeyword?.keywords || []).map(k => k?.itemValue).filter(Boolean);

            let welfareFeatures = (cached && cached.jobKnowledgeWelfareFeatures) ? cached.jobKnowledgeWelfareFeatures : job.jobKnowledgeWelfareFeatures;
            let welfareFeaturesArr = welfareFeatures || [];

            let combinedWelfare = Array.from(new Set([...keywordsArr, ...welfareFeaturesArr].filter(Boolean))).join(',');

            // 影子数据库增强工作城市字段
            let enrichedCity = '';
            if (cached) {
                enrichedCity = [cached.workCity, cached.cityDistrict, cached.streetName].filter(Boolean).join('·');
            }
            if (!enrichedCity) {
                enrichedCity = [detailedPosition.positionWorkCity, detailedPosition.positionCityDistrict].filter(Boolean).join('·');
            }
            extracted['工作城市'] = enrichedCity;

            // 将提取的数据合并到 mappedJob
            Object.assign(mappedJob, extracted);

            return {
                '平台': mappedJob['平台'] || '智联',
                '职位ID': mappedJob['职位ID'] || mappedJob.number || '',
                '职位名称': mappedJob['职位名称'] || mappedJob.name || '',
                '工作地点': mappedJob['工作城市'] || [mappedJob.workCity, mappedJob.cityDistrict, mappedJob.streetName].filter(Boolean).join('·') || mappedJob['工作地点'] || mappedJob.cityDistrict || '',
                '薪资待遇': mappedJob['薪资待遇'] || mappedJob.salary60 || '',
                '工作经验': mappedJob['工作经验'] || mappedJob.workingExp || '',
                '学历要求': mappedJob['学历要求'] || (mappedJob.eduLevel ? mappedJob.eduLevel.name : '') || '',
                '详细地址': mappedJob['详细工作地址'] || mappedJob.workAddress || mappedJob['详细地址'] || '',
                '职位描述': mappedJob['职位描述'] || '',
                '技能标签': mappedJob['技能要求标签'] || (mappedJob.skillTags ? mappedJob.skillTags.join(',') : '') || mappedJob['技能标签'] || '',
                'HR_ID': mappedJob.staffId || mappedJob['HR_ID'] || '',
                'HR姓名': mappedJob['HR姓名'] || mappedJob.staffName || '',
                'HR职位': mappedJob['HR职位'] || '',
                'HR活跃度': mappedJob['HR活跃状态'] || mappedJob['HR活跃度'] || '',
                '公司名称': mappedJob['公司全称'] || mappedJob.companyName || (mappedJob.company ? mappedJob.company.name : '') || mappedJob['公司名称'] || '',
                '公司全称': mappedJob['公司全称'] || mappedJob.companyName || (mappedJob.company ? mappedJob.company.name : '') || '',
                '公司行业': mappedJob['行业名称'] || mappedJob['公司行业'] || '',
                '公司规模': mappedJob['公司规模'] || (mappedJob.company ? mappedJob.company.size : '') || '',
                '融资阶段': mappedJob['融资阶段'] || '',
                '公司福利': combinedWelfare || (mappedJob.welfareLabel ? mappedJob.welfareLabel.map(w => w.value).join(',') : '') || mappedJob['公司福利'] || '',
                '发布时间': mappedJob['首次创建时间'] || mappedJob.firstPublishTime || mappedJob['发布时间'] || '',
                '首次创建时间': mappedJob['首次创建时间'] || mappedJob['创建时间'] || '',
                '页面更新时间': mappedJob['更新时间文本'] || mappedJob['页面更新时间'] || '',
                '职位链接': mappedJob.positionURL || mappedJob['职位链接'] || '',
                '更新时间': mappedJob.publishTime || mappedJob['更新时间'] || '',
                '创建时间': mappedJob['创建时间'] || '',
                '代理用人公司': mappedJob['代理用人公司'] || '',
                '岗位类型_外包猎头': mappedJob['岗位类型_外包猎头'] || '',
                '干净链接': mappedJob.positionURL || mappedJob['干净链接'] || '',
                '人工标签': mappedJob['人工标签'] || [],
                '是否隐藏': mappedJob['是否隐藏'] || false,
                '源数据': job
            };
        }
        return job;
    }

    root.normalizeJob = normalizeJob;
})(typeof self !== 'undefined' ? self : this);

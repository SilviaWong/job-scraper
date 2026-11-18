/**
 * 数据导出工具集 (Export Helper)
 * 支持职位数据导出为 XLSX / CSV 以及面试日程导出为 .ics 日历文件
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ExportHelper = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * 导出为 Excel (.xlsx) 文件
     */
    function exportToExcel(data, filename = '招聘数据.xlsx') {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('无可导出的数据');
        }
        if (typeof XLSX === 'undefined') {
            throw new Error('XLSX 导出库未加载');
        }

        const cleanData = data.map(item => {
            const row = { ...item };
            delete row['原始详情JSON'];
            delete row['原始列表JSON'];
            delete row['源数据'];
            return row;
        });

        const ws = XLSX.utils.json_to_sheet(cleanData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '职位数据');
        XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
    }

    /**
     * 导出为 CSV 文件
     */
    function exportToCsv(data, filename = '招聘数据.csv') {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('无可导出的数据');
        }
        if (typeof XLSX === 'undefined') {
            throw new Error('XLSX 导出库未加载');
        }

        const cleanData = data.map(item => {
            const row = { ...item };
            delete row['原始详情JSON'];
            delete row['原始列表JSON'];
            delete row['源数据'];
            return row;
        });

        const ws = XLSX.utils.json_to_sheet(cleanData);
        const csv = XLSX.utils.sheet_to_csv(ws);
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
    }

    /**
     * 导出面试为 .ics 日历文件
     */
    function exportInterviewToIcs(params) {
        const {
            companyName = '',
            jobName = '',
            startTime = '',
            endTime = '',
            location = '',
            notes = '',
            round = ''
        } = params;

        if (!startTime) {
            throw new Error('请填写面试开始时间');
        }

        const formatIcsDate = (dateStr) => {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
        };

        const dtStart = formatIcsDate(startTime);
        const dtEnd = endTime ? formatIcsDate(endTime) : formatIcsDate(new Date(new Date(startTime).getTime() + 60 * 60 * 1000));
        const summary = `面试【${round || '技术面'}】: ${companyName} - ${jobName}`;
        const description = (notes || '无备注').replace(/\n/g, '\\n');

        const icsLines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Job Scraper//Interview Calendar//CN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `UID:${Date.now()}@jobscraper.ext`,
            `DTSTAMP:${formatIcsDate(new Date())}`,
            `DTSTART:${dtStart}`,
            dtEnd ? `DTEND:${dtEnd}` : '',
            `SUMMARY:${summary}`,
            `DESCRIPTION:${description}`,
            `LOCATION:${location || '线上面试 / 视频会议'}`,
            'STATUS:CONFIRMED',
            'END:VEVENT',
            'END:VCALENDAR'
        ].filter(Boolean);

        const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
        const cleanName = `面试_${companyName}_${jobName}`.replace(/[\s\/:*?"<>|]+/g, '_');
        downloadBlob(blob, `${cleanName}.ics`);
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return {
        exportToExcel,
        exportToCsv,
        exportInterviewToIcs
    };
});

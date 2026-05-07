import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDir = '/Users/mingyue/PEBS_APS_AI/customer-validation-package';
const outputPath = `${outputDir}/AI_APS_客户数据模板.xlsx`;

const workbook = Workbook.create();

const sheets = {
  guide: workbook.worksheets.add('使用说明'),
  orders: workbook.worksheets.add('订单'),
  routing: workbook.worksheets.add('工艺路线'),
  resources: workbook.worksheets.add('设备资源'),
  calendar: workbook.worksheets.add('班次日历'),
  inventory: workbook.worksheets.add('物料齐套'),
  wip: workbook.worksheets.add('在制品'),
  dictionary: workbook.worksheets.add('字段说明'),
};

const writeRows = (sheet, rows) => {
  const colCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array.from({ length: colCount - row.length }, () => '')]);
  sheet.getRangeByIndexes(0, 0, normalized.length, colCount).values = normalized;
  const used = sheet.getRangeByIndexes(0, 0, normalized.length, colCount);
  used.format.wrapText = true;
  used.format.font = { name: 'Microsoft YaHei', size: 10 };
  sheet.getRangeByIndexes(0, 0, 1, colCount).format = {
    fill: '#0F6F64',
    font: { bold: true, color: '#FFFFFF' },
  };
  sheet.freezePanes.freezeRows(1);
  used.format.autofitColumns();
};

writeRows(sheets.guide, [
  ['AI APS 客户数据模板', '', '', ''],
  ['填写说明', '请至少填写“订单、工艺路线、设备资源”三张表。班次、物料齐套、在制品为增强项。', '', ''],
  ['脱敏建议', '客户名称、订单号、零件号可脱敏；无需提供金额、成本、报价、图纸。', '', ''],
  ['多值分隔', '可选设备、能力标签、替代物料等多个值请用 | 分隔，例如 CNC-01|CNC-02。', '', ''],
  ['时间格式', '建议使用 2026-05-15 18:00 这种格式。', '', ''],
  ['POC 最小范围', '建议选择 1 个车间、10-50 台设备、100-500 个生产任务、2-4 周计划周期。', '', ''],
]);

writeRows(sheets.orders, [
  ['order_id', 'customer', 'part_id', 'quantity', 'due_time', 'priority', 'order_type', 'status'],
  ['SO-202605001', '客户A', 'P-A320-01', 100, '2026-05-15 18:00', '高', '正式订单', '待排产'],
  ['SO-202605002', '客户B', 'P-B118-02', 60, '2026-05-16 12:00', '中', '正式订单', '待排产'],
  ['SO-202605003', '客户C', 'P-C077-06', 80, '2026-05-17 18:00', '低', '预测订单', '待排产'],
]);

writeRows(sheets.routing, [
  ['part_id', 'operation_seq', 'operation_code', 'operation_name', 'predecessor_seq', 'eligible_resources', 'setup_minutes', 'run_minutes_per_piece', 'inspection_minutes', 'outsourcing_flag', 'tooling_required'],
  ['P-A320-01', 10, 'OP10', '粗加工', '', 'CNC-01|CNC-02', 30, 4, 10, 'N', 'JIG-01'],
  ['P-A320-01', 20, 'OP20', '精加工', 10, 'CNC-08|CNC-12', 45, 6, 20, 'N', 'JIG-02'],
  ['P-B118-02', 10, 'OP10', '车削', '', 'LATHE-01|LATHE-02', 20, 3, 10, 'N', 'JIG-03'],
]);

writeRows(sheets.resources, [
  ['resource_id', 'resource_name', 'resource_type', 'work_center', 'capability_tags', 'calendar_id', 'status', 'alternative_group'],
  ['CNC-01', 'CNC一号机', 'CNC', '机加工', 'CNC_3AXIS|ROUGH', 'CAL-01', '可用', 'CNC_ROUGH'],
  ['CNC-08', 'CNC八号机', 'CNC', '精加工', 'CNC_5AXIS|PRECISION', 'CAL-01', '可用', 'CNC_PRECISION'],
  ['LATHE-01', '数控车床一号', 'Lathe', '车削', 'LATHE|TURNING', 'CAL-01', '可用', 'LATHE_STD'],
]);

writeRows(sheets.calendar, [
  ['calendar_id', 'date', 'shift_name', 'start_time', 'end_time', 'available', 'overtime_flag'],
  ['CAL-01', '2026-05-11', '白班', '08:00', '17:00', 'Y', 'N'],
  ['CAL-01', '2026-05-11', '晚班', '18:00', '22:00', 'Y', 'Y'],
  ['CAL-01', '2026-05-12', '白班', '08:00', '17:00', 'Y', 'N'],
]);

writeRows(sheets.inventory, [
  ['material_id', 'material_name', 'available_qty', 'required_qty', 'available_time', 'substitute_materials', 'status'],
  ['M-A001', '铝棒A001', 500, 300, '2026-05-10 08:00', '', '齐套'],
  ['M-B002', '钢件B002', 40, 80, '2026-05-13 10:00', 'M-B002-SUB', '缺料'],
]);

writeRows(sheets.wip, [
  ['job_id', 'order_id', 'part_id', 'quantity', 'current_operation_seq', 'completed_qty', 'remaining_qty', 'current_resource', 'status'],
  ['JOB-001', 'SO-202605001', 'P-A320-01', 100, 10, 40, 60, 'CNC-01', '生产中'],
  ['JOB-002', 'SO-202605002', 'P-B118-02', 60, 0, 0, 60, '', '未开工'],
]);

writeRows(sheets.dictionary, [
  ['表名', '字段', '中文含义', '是否必填', '填写说明'],
  ['订单', 'order_id', '订单号', '是', '客户订单号或生产订单号，需唯一'],
  ['订单', 'part_id', '零件号/料号', '是', '需与工艺路线中的 part_id 一致'],
  ['订单', 'quantity', '数量', '是', '订单需求数量'],
  ['订单', 'due_time', '交期', '是', '建议格式 2026-05-15 18:00'],
  ['工艺路线', 'operation_seq', '工序序号', '是', '同一零件内按数字升序加工'],
  ['工艺路线', 'eligible_resources', '可选设备', '是', '多个设备用 | 分隔'],
  ['工艺路线', 'setup_minutes', '准备时间分钟', '建议', '换型、装夹、调机等固定时间'],
  ['工艺路线', 'run_minutes_per_piece', '单件加工时间分钟', '建议', '标准节拍'],
  ['设备资源', 'resource_id', '设备编号', '是', '需与工艺路线可选设备一致'],
  ['设备资源', 'calendar_id', '日历编号', '是', '关联班次日历'],
  ['班次日历', 'available', '是否可用', '建议', 'Y/N'],
  ['物料齐套', 'status', '齐套状态', '增强', '齐套、缺料、部分齐套'],
  ['在制品', 'current_operation_seq', '当前工序', '增强', '0 表示未开工'],
]);

for (const sheet of Object.values(sheets)) {
  sheet.showGridLines = false;
}

await fs.mkdir(outputDir, { recursive: true });
const blob = await SpreadsheetFile.exportXlsx(workbook);
await blob.save(outputPath);

const imported = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const summary = await imported.inspect({
  kind: 'sheet,table',
  tableMaxRows: 3,
  tableMaxCols: 6,
  maxChars: 4000,
});
console.log(summary.ndjson);
console.log(outputPath);

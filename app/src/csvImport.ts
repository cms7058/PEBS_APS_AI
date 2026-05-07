import type { Order, Resource, Routing } from './types';

export type ImportKind = 'orders' | 'resources' | 'routings';

export type ImportIssue = {
  row: number;
  message: string;
};

export type ImportResult<T> = {
  rows: T[];
  issues: ImportIssue[];
};

export type FieldDefinition = {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
};

export type FieldMapping = Record<string, string>;

const splitCsvLine = (line: string) => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, ''));
};

export const parseCsv = (text: string) => {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { headers: [], records: [] as Record<string, string>[] };
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  const records = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = cells[index] ?? '';
      return record;
    }, {});
  });
  return { headers, records };
};

export const fieldDefinitions: Record<ImportKind, FieldDefinition[]> = {
  orders: [
    { key: 'order_id', label: '订单号', required: true, aliases: ['order_id', '订单号', '订单编号', '客户订单号', '销售订单', 'so', 'so_no', '单号'] },
    { key: 'customer', label: '客户', required: false, aliases: ['customer', '客户', '客户名称', '客户名', 'client'] },
    { key: 'part_id', label: '零件号/料号', required: true, aliases: ['part_id', '零件号', '料号', '物料编码', '产品编码', '产品料号', '图号', 'part', 'item_code', 'material_code'] },
    { key: 'quantity', label: '数量', required: true, aliases: ['quantity', '数量', '订单数量', '需求数量', 'qty', 'order_qty'] },
    { key: 'due_time', label: '交期', required: true, aliases: ['due_time', '交期', '交货日期', '交付时间', '要求交期', '需求日期', 'due_date', 'delivery_date'] },
    { key: 'priority', label: '优先级', required: false, aliases: ['priority', '优先级', '紧急度', '订单优先级'] },
    { key: 'order_type', label: '订单类型', required: false, aliases: ['order_type', '订单类型', '类型', '需求类型'] },
    { key: 'status', label: '状态', required: false, aliases: ['status', '状态', '订单状态'] },
  ],
  resources: [
    { key: 'resource_id', label: '设备编号', required: true, aliases: ['resource_id', '设备编号', '设备号', '资源编号', '机台编号', 'machine_id', 'machine_code'] },
    { key: 'resource_name', label: '设备名称', required: true, aliases: ['resource_name', '设备名称', '机台名称', '资源名称', 'machine_name'] },
    { key: 'resource_type', label: '设备类型', required: false, aliases: ['resource_type', '设备类型', '资源类型', '机台类型', 'type'] },
    { key: 'work_center', label: '工作中心', required: false, aliases: ['work_center', '工作中心', '车间', '产线', '工段'] },
    { key: 'capability_tags', label: '能力标签', required: false, aliases: ['capability_tags', '能力标签', '加工能力', '能力', 'capability'] },
    { key: 'calendar_id', label: '日历编号', required: true, aliases: ['calendar_id', '日历编号', '班次日历', '班次', 'calendar'] },
    { key: 'status', label: '状态', required: false, aliases: ['status', '状态', '设备状态'] },
    { key: 'alternative_group', label: '替代组', required: false, aliases: ['alternative_group', '替代组', '替代设备组', '资源组'] },
  ],
  routings: [
    { key: 'part_id', label: '零件号/料号', required: true, aliases: ['part_id', '零件号', '料号', '物料编码', '产品编码', '图号'] },
    { key: 'operation_seq', label: '工序序号', required: true, aliases: ['operation_seq', '工序序号', '工序顺序', '序号', 'op_seq', '工步'] },
    { key: 'operation_code', label: '工序编码', required: false, aliases: ['operation_code', '工序编码', '工序代码', 'op_code'] },
    { key: 'operation_name', label: '工序名称', required: true, aliases: ['operation_name', '工序名称', '工序', '作业名称', 'op_name'] },
    { key: 'predecessor_seq', label: '前置工序', required: false, aliases: ['predecessor_seq', '前置工序', '前序', '上道工序'] },
    { key: 'eligible_resources', label: '可选设备', required: true, aliases: ['eligible_resources', '可选设备', '可用设备', '设备', '设备编号', '机台', 'resource', 'machine'] },
    { key: 'setup_minutes', label: '准备时间', required: false, aliases: ['setup_minutes', '准备时间', '调机时间', '换型时间', 'setup'] },
    { key: 'run_minutes_per_piece', label: '单件加工时间', required: false, aliases: ['run_minutes_per_piece', '单件加工时间', '标准工时', '加工时间', '节拍', 'run_time'] },
    { key: 'inspection_minutes', label: '检验时间', required: false, aliases: ['inspection_minutes', '检验时间', '首检时间', 'inspection'] },
    { key: 'outsourcing_flag', label: '是否外协', required: false, aliases: ['outsourcing_flag', '是否外协', '外协', '委外'] },
    { key: 'tooling_required', label: '工装需求', required: false, aliases: ['tooling_required', '工装需求', '夹具', '模具', '刀具'] },
  ],
};

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[\s_\-/.()（）]/g, '');

export const suggestMapping = (kind: ImportKind, headers: string[]): FieldMapping => {
  const mapping: FieldMapping = {};
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));
  fieldDefinitions[kind].forEach((field) => {
    const aliases = field.aliases.map(normalizeHeader);
    const exact = normalizedHeaders.find((item) => aliases.includes(item.normalized));
    const fuzzy = exact ?? normalizedHeaders.find((item) => aliases.some((alias) => item.normalized.includes(alias) || alias.includes(item.normalized)));
    mapping[field.key] = fuzzy?.header ?? '';
  });
  return mapping;
};

const applyMapping = (records: Record<string, string>[], mapping: FieldMapping) =>
  records.map((record) =>
    Object.entries(mapping).reduce<Record<string, string>>((mapped, [systemField, sourceField]) => {
      mapped[systemField] = sourceField ? record[sourceField] ?? '' : '';
      return mapped;
    }, {}),
  );

const numberValue = (value: string) => Number(value || 0);

const boolValue = (value: string) => ['Y', 'y', 'true', 'TRUE', '是', '1'].includes(value);

const listValue = (value: string) =>
  value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);

const requireFields = (record: Record<string, string>, fields: string[], row: number, issues: ImportIssue[]) => {
  fields.forEach((field) => {
    if (!record[field]) issues.push({ row, message: `缺少必填字段 ${field}` });
  });
};

export const parseOrdersCsv = (text: string): ImportResult<Order> => {
  const { headers, records } = parseCsv(text);
  return parseOrdersRecords(applyMapping(records, suggestMapping('orders', headers)));
};

const parseOrdersRecords = (records: Record<string, string>[]): ImportResult<Order> => {
  const issues: ImportIssue[] = [];
  const rows: Order[] = [];
  records.forEach((record, index) => {
    const row = index + 2;
    requireFields(record, ['order_id', 'part_id', 'quantity', 'due_time'], row, issues);
    const quantity = numberValue(record.quantity);
    if (quantity <= 0) issues.push({ row, message: 'quantity 必须大于 0' });
    if (record.due_time && Number.isNaN(new Date(record.due_time.replace(' ', 'T')).getTime())) {
      issues.push({ row, message: 'due_time 格式无法识别' });
    }
    rows.push({
      orderId: record.order_id,
      customer: record.customer || '未指定客户',
      partId: record.part_id,
      quantity,
      dueTime: record.due_time,
      priority: record.priority === '高' || record.priority === '低' ? record.priority : '中',
      orderType: record.order_type || '正式订单',
      status: record.status || '待排产',
    });
  });
  return { rows: issues.length ? [] : rows, issues };
};

export const parseResourcesCsv = (text: string): ImportResult<Resource> => {
  const { headers, records } = parseCsv(text);
  return parseResourcesRecords(applyMapping(records, suggestMapping('resources', headers)));
};

const parseResourcesRecords = (records: Record<string, string>[]): ImportResult<Resource> => {
  const issues: ImportIssue[] = [];
  const rows: Resource[] = [];
  records.forEach((record, index) => {
    const row = index + 2;
    requireFields(record, ['resource_id', 'resource_name', 'calendar_id'], row, issues);
    rows.push({
      resourceId: record.resource_id,
      resourceName: record.resource_name,
      resourceType: record.resource_type || 'Resource',
      workCenter: record.work_center || '默认工作中心',
      capabilityTags: listValue(record.capability_tags),
      calendarId: record.calendar_id || 'CAL-01',
      status: record.status === '停机' || record.status === '维护' ? record.status : '可用',
      alternativeGroup: record.alternative_group || '',
    });
  });
  return { rows: issues.length ? [] : rows, issues };
};

export const parseRoutingsCsv = (text: string): ImportResult<Routing> => {
  const { headers, records } = parseCsv(text);
  return parseRoutingsRecords(applyMapping(records, suggestMapping('routings', headers)));
};

const parseRoutingsRecords = (records: Record<string, string>[]): ImportResult<Routing> => {
  const issues: ImportIssue[] = [];
  const rows: Routing[] = [];
  records.forEach((record, index) => {
    const row = index + 2;
    requireFields(record, ['part_id', 'operation_seq', 'operation_name', 'eligible_resources'], row, issues);
    const operationSeq = numberValue(record.operation_seq);
    const eligibleResources = listValue(record.eligible_resources);
    if (operationSeq <= 0) issues.push({ row, message: 'operation_seq 必须大于 0' });
    if (eligibleResources.length === 0) issues.push({ row, message: 'eligible_resources 至少需要一个资源' });
    rows.push({
      partId: record.part_id,
      operationSeq,
      operationCode: record.operation_code || `OP${operationSeq}`,
      operationName: record.operation_name,
      predecessorSeq: record.predecessor_seq ? numberValue(record.predecessor_seq) : undefined,
      eligibleResources,
      setupMinutes: numberValue(record.setup_minutes),
      runMinutesPerPiece: numberValue(record.run_minutes_per_piece),
      inspectionMinutes: numberValue(record.inspection_minutes),
      outsourcingFlag: boolValue(record.outsourcing_flag),
      toolingRequired: record.tooling_required,
    });
  });
  return { rows: issues.length ? [] : rows, issues };
};

export const parseByKind = (kind: ImportKind, text: string) => {
  const { headers, records } = parseCsv(text);
  return parseByKindWithMapping(kind, records, suggestMapping(kind, headers));
};

export const parseByKindWithMapping = (kind: ImportKind, records: Record<string, string>[], mapping: FieldMapping) => {
  const mapped = applyMapping(records, mapping);
  if (kind === 'orders') return parseOrdersRecords(mapped);
  if (kind === 'resources') return parseResourcesRecords(mapped);
  return parseRoutingsRecords(mapped);
};

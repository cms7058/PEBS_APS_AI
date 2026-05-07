import type { CalendarSlot, InventoryStatus, Order, Resource, Routing, TrialState, WipStatus } from './types';

export const trialState: TrialState = {
  tenantName: 'PEBS 试用工厂',
  startAt: '2026-05-06',
  endAt: '2026-05-20',
  maxUsers: 3,
  maxResources: 50,
  maxOrders: 500,
  maxOperations: 2000,
  dailyRunsLimit: 10,
  todayRuns: 0,
};

export const sampleOrders: Order[] = [
  { orderId: 'SO-202605001', customer: '客户A', partId: 'P-A320-01', quantity: 80, dueTime: '2026-05-12 18:00', priority: '高', orderType: '正式订单', status: '待排产' },
  { orderId: 'SO-202605002', customer: '客户B', partId: 'P-B118-02', quantity: 120, dueTime: '2026-05-13 12:00', priority: '中', orderType: '正式订单', status: '待排产' },
  { orderId: 'SO-202605003', customer: '客户C', partId: 'P-C077-06', quantity: 60, dueTime: '2026-05-13 20:00', priority: '中', orderType: '正式订单', status: '待排产' },
  { orderId: 'SO-202605004', customer: '客户A', partId: 'P-A320-01', quantity: 50, dueTime: '2026-05-14 16:00', priority: '高', orderType: '备件', status: '待排产' },
  { orderId: 'SO-202605005', customer: '客户D', partId: 'P-D221-09', quantity: 140, dueTime: '2026-05-15 18:00', priority: '低', orderType: '预测', status: '待排产' },
  { orderId: 'SO-202605006', customer: '客户E', partId: 'P-E019-03', quantity: 90, dueTime: '2026-05-15 12:00', priority: '中', orderType: '正式订单', status: '待排产' },
];

export const sampleRoutings: Routing[] = [
  { partId: 'P-A320-01', operationSeq: 10, operationCode: 'OP10', operationName: '粗加工', eligibleResources: ['CNC-01', 'CNC-02'], setupMinutes: 25, runMinutesPerPiece: 2.6, inspectionMinutes: 10, outsourcingFlag: false, toolingRequired: 'JIG-01' },
  { partId: 'P-A320-01', operationSeq: 20, operationCode: 'OP20', operationName: '精加工', predecessorSeq: 10, eligibleResources: ['CNC-08', 'CNC-12'], setupMinutes: 40, runMinutesPerPiece: 4.8, inspectionMinutes: 20, outsourcingFlag: false, toolingRequired: 'JIG-02' },
  { partId: 'P-A320-01', operationSeq: 30, operationCode: 'OP30', operationName: '终检', predecessorSeq: 20, eligibleResources: ['QC-01'], setupMinutes: 10, runMinutesPerPiece: 0.7, inspectionMinutes: 35, outsourcingFlag: false },
  { partId: 'P-B118-02', operationSeq: 10, operationCode: 'OP10', operationName: '车削', eligibleResources: ['LATHE-01', 'LATHE-02'], setupMinutes: 20, runMinutesPerPiece: 2.2, inspectionMinutes: 10, outsourcingFlag: false, toolingRequired: 'JIG-03' },
  { partId: 'P-B118-02', operationSeq: 20, operationCode: 'OP20', operationName: '钻孔', predecessorSeq: 10, eligibleResources: ['CNC-01', 'CNC-02'], setupMinutes: 25, runMinutesPerPiece: 1.4, inspectionMinutes: 10, outsourcingFlag: false },
  { partId: 'P-C077-06', operationSeq: 10, operationCode: 'OP10', operationName: '五轴加工', eligibleResources: ['CNC-12'], setupMinutes: 55, runMinutesPerPiece: 6.5, inspectionMinutes: 25, outsourcingFlag: false, toolingRequired: 'JIG-12' },
  { partId: 'P-C077-06', operationSeq: 20, operationCode: 'OP20', operationName: '磨削', predecessorSeq: 10, eligibleResources: ['GRIND-03'], setupMinutes: 30, runMinutesPerPiece: 3.8, inspectionMinutes: 20, outsourcingFlag: false },
  { partId: 'P-D221-09', operationSeq: 10, operationCode: 'OP10', operationName: '粗加工', eligibleResources: ['CNC-01', 'CNC-02'], setupMinutes: 20, runMinutesPerPiece: 1.8, inspectionMinutes: 10, outsourcingFlag: false },
  { partId: 'P-D221-09', operationSeq: 20, operationCode: 'OP20', operationName: '热处理外协', predecessorSeq: 10, eligibleResources: ['OUT-HT'], setupMinutes: 0, runMinutesPerPiece: 7.5, inspectionMinutes: 0, outsourcingFlag: true },
  { partId: 'P-E019-03', operationSeq: 10, operationCode: 'OP10', operationName: '车削', eligibleResources: ['LATHE-01', 'LATHE-02'], setupMinutes: 20, runMinutesPerPiece: 2.5, inspectionMinutes: 12, outsourcingFlag: false },
  { partId: 'P-E019-03', operationSeq: 20, operationCode: 'OP20', operationName: '装配检测', predecessorSeq: 10, eligibleResources: ['ASSY-01'], setupMinutes: 15, runMinutesPerPiece: 3.2, inspectionMinutes: 30, outsourcingFlag: false },
];

export const sampleResources: Resource[] = [
  { resourceId: 'CNC-01', resourceName: 'CNC 一号机', resourceType: 'CNC', workCenter: '机加工', capabilityTags: ['CNC_3AXIS', 'ROUGH'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'CNC_ROUGH' },
  { resourceId: 'CNC-02', resourceName: 'CNC 二号机', resourceType: 'CNC', workCenter: '机加工', capabilityTags: ['CNC_3AXIS', 'ROUGH'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'CNC_ROUGH' },
  { resourceId: 'CNC-08', resourceName: 'CNC 八号机', resourceType: 'CNC', workCenter: '精加工', capabilityTags: ['CNC_5AXIS', 'PRECISION'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'CNC_PRECISION' },
  { resourceId: 'CNC-12', resourceName: 'CNC 十二号机', resourceType: 'CNC', workCenter: '精加工', capabilityTags: ['CNC_5AXIS', 'PRECISION'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'CNC_PRECISION' },
  { resourceId: 'LATHE-01', resourceName: '数控车床一号', resourceType: 'Lathe', workCenter: '车削', capabilityTags: ['LATHE'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'LATHE_STD' },
  { resourceId: 'LATHE-02', resourceName: '数控车床二号', resourceType: 'Lathe', workCenter: '车削', capabilityTags: ['LATHE'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'LATHE_STD' },
  { resourceId: 'GRIND-03', resourceName: '磨床三号', resourceType: 'Grinding', workCenter: '磨削', capabilityTags: ['GRIND'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'GRIND_STD' },
  { resourceId: 'QC-01', resourceName: '质检一号', resourceType: 'QC', workCenter: '质检', capabilityTags: ['QC'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'QC_STD' },
  { resourceId: 'ASSY-01', resourceName: '装配线一号', resourceType: 'Assembly', workCenter: '装配', capabilityTags: ['ASSY'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'ASSY_STD' },
  { resourceId: 'OUT-HT', resourceName: '热处理外协', resourceType: 'Outsource', workCenter: '外协', capabilityTags: ['HEAT_TREAT'], calendarId: 'CAL-01', status: '可用', alternativeGroup: 'OUTSOURCE' },
];

export const sampleCalendar: CalendarSlot[] = Array.from({ length: 10 }).flatMap((_, index) => {
  const day = String(11 + index).padStart(2, '0');
  return [
    { calendarId: 'CAL-01', date: `2026-05-${day}`, shiftName: '白班', startTime: '08:00', endTime: '17:00', available: true, overtimeFlag: false },
    { calendarId: 'CAL-01', date: `2026-05-${day}`, shiftName: '晚班', startTime: '18:00', endTime: '22:00', available: true, overtimeFlag: true },
  ];
});

export const sampleInventory: InventoryStatus[] = [
  { materialId: 'M-A001', materialName: '铝棒 A001', availableQty: 500, requiredQty: 300, availableTime: '2026-05-10 08:00', substituteMaterials: [], status: '齐套' },
  { materialId: 'M-B002', materialName: '钢件 B002', availableQty: 40, requiredQty: 80, availableTime: '2026-05-13 10:00', substituteMaterials: ['M-B002-SUB'], status: '缺料' },
  { materialId: 'M-C003', materialName: '锻件 C003', availableQty: 120, requiredQty: 60, availableTime: '2026-05-10 08:00', substituteMaterials: [], status: '齐套' },
];

export const sampleWip: WipStatus[] = [
  { jobId: 'JOB-001', orderId: 'SO-202605001', partId: 'P-A320-01', quantity: 80, currentOperationSeq: 10, completedQty: 20, remainingQty: 60, currentResource: 'CNC-01', status: '生产中' },
  { jobId: 'JOB-002', orderId: 'SO-202605002', partId: 'P-B118-02', quantity: 120, currentOperationSeq: 0, completedQty: 0, remainingQty: 120, status: '未开工' },
];

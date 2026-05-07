export type Priority = '高' | '中' | '低';

export type Order = {
  orderId: string;
  customer: string;
  partId: string;
  quantity: number;
  dueTime: string;
  priority: Priority;
  orderType: string;
  status: string;
};

export type Routing = {
  partId: string;
  operationSeq: number;
  operationCode: string;
  operationName: string;
  predecessorSeq?: number;
  eligibleResources: string[];
  setupMinutes: number;
  runMinutesPerPiece: number;
  inspectionMinutes: number;
  outsourcingFlag: boolean;
  toolingRequired?: string;
};

export type Resource = {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  workCenter: string;
  capabilityTags: string[];
  calendarId: string;
  status: '可用' | '停机' | '维护';
  alternativeGroup: string;
};

export type CalendarSlot = {
  calendarId: string;
  date: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  available: boolean;
  overtimeFlag: boolean;
};

export type InventoryStatus = {
  materialId: string;
  materialName: string;
  availableQty: number;
  requiredQty: number;
  availableTime: string;
  substituteMaterials: string[];
  status: '齐套' | '缺料' | '部分齐套';
};

export type WipStatus = {
  jobId: string;
  orderId: string;
  partId: string;
  quantity: number;
  currentOperationSeq: number;
  completedQty: number;
  remainingQty: number;
  currentResource?: string;
  status: '未开工' | '生产中' | '暂停' | '完成';
};

export type ScheduledOperation = {
  id: string;
  orderId: string;
  customer: string;
  partId: string;
  operationSeq: number;
  operationName: string;
  resourceId: string;
  start: Date;
  end: Date;
  setupMinutes: number;
  runMinutes: number;
  delayMinutes: number;
  delayReason: string;
  locked: boolean;
};

export type ScheduleKpi = {
  totalOrders: number;
  scheduledOperations: number;
  delayedOrders: number;
  onTimeRate: number;
  avgDelayHours: number;
  bottleneckResource: string;
  utilization: number;
};

export type SchedulePlan = {
  id: string;
  name: string;
  generatedAt: Date;
  objective: string;
  operations: ScheduledOperation[];
  kpi: ScheduleKpi;
};

export type TrialState = {
  tenantName: string;
  startAt: string;
  endAt: string;
  maxUsers: number;
  maxResources: number;
  maxOrders: number;
  maxOperations: number;
  dailyRunsLimit: number;
  todayRuns: number;
};

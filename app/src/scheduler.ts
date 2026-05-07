import type { CalendarSlot, Order, Resource, Routing, ScheduleKpi, SchedulePlan, ScheduledOperation, WipStatus } from './types';

type SchedulerInput = {
  orders: Order[];
  routings: Routing[];
  resources: Resource[];
  calendar: CalendarSlot[];
  wip: WipStatus[];
  objective?: string;
  planName?: string;
  unavailable?: { resourceId: string; start: Date; end: Date }[];
  materialHolds?: { orderId: string; availableAt: Date; reason: string }[];
};

const priorityWeight: Record<string, number> = { 高: 0, 中: 1, 低: 2 };

const parseDate = (value: string) => new Date(value.replace(' ', 'T'));

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

const diffMinutes = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 60_000);

const getCalendarStart = (calendar: CalendarSlot[]) => {
  const starts = calendar
    .filter((slot) => slot.available)
    .map((slot) => parseDate(`${slot.date} ${slot.startTime}`))
    .sort((a, b) => a.getTime() - b.getTime());
  return starts[0] ?? new Date('2026-05-11T08:00:00');
};

const isInsideAvailability = (date: Date, resource: Resource, calendar: CalendarSlot[]) =>
  calendar.some((slot) => {
    if (!slot.available || slot.calendarId !== resource.calendarId) return false;
    const start = parseDate(`${slot.date} ${slot.startTime}`);
    const end = parseDate(`${slot.date} ${slot.endTime}`);
    return date >= start && date < end;
  });

const nextAvailableMinute = (date: Date, resource: Resource, calendar: CalendarSlot[], unavailable: SchedulerInput['unavailable'] = []) => {
  let cursor = new Date(date);
  for (let i = 0; i < 60 * 24 * 45; i += 1) {
    const blocked = unavailable.some((item) => item.resourceId === resource.resourceId && cursor >= item.start && cursor < item.end);
    if (!blocked && isInsideAvailability(cursor, resource, calendar)) return cursor;
    cursor = addMinutes(cursor, 15);
  }
  return cursor;
};

const placeOperation = (
  earliest: Date,
  durationMinutes: number,
  resource: Resource,
  calendar: CalendarSlot[],
  unavailable: SchedulerInput['unavailable'] = [],
) => {
  let start = nextAvailableMinute(earliest, resource, calendar, unavailable);
  let cursor = new Date(start);
  let remaining = durationMinutes;
  while (remaining > 0) {
    cursor = nextAvailableMinute(cursor, resource, calendar, unavailable);
    cursor = addMinutes(cursor, 15);
    remaining -= 15;
  }
  return { start, end: cursor };
};

const buildDelayReason = (operation: ScheduledOperation, due: Date) => {
  if (operation.end <= due) return '';
  if (operation.resourceId.includes('OUT')) return '外协周期占用导致订单完工晚于交期';
  if (operation.locked) return '在制任务已锁定，后续工序只能顺延';
  return `${operation.resourceId} 负荷较高，${operation.operationName} 排队等待导致延期`;
};

export const runSchedule = ({
  orders,
  routings,
  resources,
  calendar,
  wip,
  objective = '交期优先',
  planName = '基础排产方案',
  unavailable = [],
  materialHolds = [],
}: SchedulerInput): SchedulePlan => {
  const resourceMap = new Map(resources.map((resource) => [resource.resourceId, resource]));
  const resourceReady = new Map<string, Date>();
  const planStart = getCalendarStart(calendar);
  resources.forEach((resource) => resourceReady.set(resource.resourceId, planStart));

  const ordered = [...orders].sort((a, b) => {
    const p = priorityWeight[a.priority] - priorityWeight[b.priority];
    if (p !== 0) return p;
    return parseDate(a.dueTime).getTime() - parseDate(b.dueTime).getTime();
  });

  const scheduled: ScheduledOperation[] = [];
  const orderEnd = new Map<string, Date>();

  ordered.forEach((order) => {
    const orderRoutings = routings
      .filter((routing) => routing.partId === order.partId)
      .sort((a, b) => a.operationSeq - b.operationSeq);
    const wipRow = wip.find((item) => item.orderId === order.orderId);
    const materialHold = materialHolds.find((item) => item.orderId === order.orderId);
    let previousEnd = materialHold ? materialHold.availableAt : planStart;

    orderRoutings.forEach((routing) => {
      if (wipRow && wipRow.currentOperationSeq > routing.operationSeq) {
        return;
      }
      const qty = wipRow?.orderId === order.orderId ? Math.max(wipRow.remainingQty, order.quantity) : order.quantity;
      const duration = Math.max(15, routing.setupMinutes + routing.inspectionMinutes + Math.ceil(routing.runMinutesPerPiece * qty));
      const candidates = routing.eligibleResources
        .map((id) => resourceMap.get(id))
        .filter((resource): resource is Resource => resource != null && resource.status === '可用');

      const best = candidates
        .map((resource) => {
          const resourceAvailable = resourceReady.get(resource.resourceId) ?? planStart;
          const earliest = new Date(Math.max(previousEnd.getTime(), resourceAvailable.getTime()));
          const slot = placeOperation(earliest, duration, resource, calendar, unavailable);
          return { resource, slot };
        })
        .sort((a, b) => a.slot.end.getTime() - b.slot.end.getTime())[0];

      if (!best) return;

      resourceReady.set(best.resource.resourceId, best.slot.end);
      previousEnd = best.slot.end;
      orderEnd.set(order.orderId, best.slot.end);
      const due = parseDate(order.dueTime);
      const op: ScheduledOperation = {
        id: `${order.orderId}-${routing.operationSeq}`,
        orderId: order.orderId,
        customer: order.customer,
        partId: order.partId,
        operationSeq: routing.operationSeq,
        operationName: routing.operationName,
        resourceId: best.resource.resourceId,
        start: best.slot.start,
        end: best.slot.end,
        setupMinutes: routing.setupMinutes,
        runMinutes: duration - routing.setupMinutes - routing.inspectionMinutes,
        delayMinutes: Math.max(0, diffMinutes(best.slot.end, due)),
        delayReason: materialHold?.reason ?? '',
        locked: Boolean(wipRow && wipRow.currentOperationSeq === routing.operationSeq && wipRow.status === '生产中'),
      };
      op.delayReason = op.delayReason || buildDelayReason(op, due);
      scheduled.push(op);
    });
  });

  const delayedOrders = [...orderEnd.entries()].filter(([orderId, end]) => {
    const order = orders.find((item) => item.orderId === orderId);
    return order ? end > parseDate(order.dueTime) : false;
  });

  if (scheduled.length === 0) {
    return {
      id: crypto.randomUUID(),
      name: planName,
      generatedAt: new Date(),
      objective,
      operations: [],
      kpi: {
        totalOrders: orders.length,
        scheduledOperations: 0,
        delayedOrders: 0,
        onTimeRate: 0,
        avgDelayHours: 0,
        bottleneckResource: '暂无',
        utilization: 0,
      },
    };
  }

  const resourceBusy = new Map<string, number>();
  scheduled.forEach((op) => resourceBusy.set(op.resourceId, (resourceBusy.get(op.resourceId) ?? 0) + diffMinutes(op.end, op.start)));
  const [bottleneckResource = '暂无', busyMinutes = 0] = [...resourceBusy.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  const horizon = Math.max(1, diffMinutes(new Date(Math.max(...scheduled.map((op) => op.end.getTime()))), planStart));
  const totalDelay = delayedOrders.reduce((sum, [orderId, end]) => {
    const order = orders.find((item) => item.orderId === orderId);
    return sum + (order ? Math.max(0, diffMinutes(end, parseDate(order.dueTime))) : 0);
  }, 0);

  const kpi: ScheduleKpi = {
    totalOrders: orders.length,
    scheduledOperations: scheduled.length,
    delayedOrders: delayedOrders.length,
    onTimeRate: Math.round(((orders.length - delayedOrders.length) / Math.max(1, orders.length)) * 100),
    avgDelayHours: Number((totalDelay / Math.max(1, delayedOrders.length) / 60).toFixed(1)),
    bottleneckResource,
    utilization: Math.min(100, Math.round((busyMinutes / horizon) * 100)),
  };

  return {
    id: crypto.randomUUID(),
    name: planName,
    generatedAt: new Date(),
    objective,
    operations: scheduled,
    kpi,
  };
};

export const explainOrderDelay = (plan: SchedulePlan, orderId: string) => {
  const ops = plan.operations.filter((op) => op.orderId === orderId).sort((a, b) => b.end.getTime() - a.end.getTime());
  const latest = ops[0];
  if (!latest) return '未找到该订单的排产结果。';
  if (latest.delayMinutes <= 0) return `${orderId} 当前未延期，计划完工时间为 ${formatDateTime(latest.end)}。`;
  return `${orderId} 延期 ${(latest.delayMinutes / 60).toFixed(1)} 小时，主要原因是 ${latest.delayReason || `${latest.resourceId} 资源排队`}。最终工序 ${latest.operationName} 安排在 ${latest.resourceId}，计划完工 ${formatDateTime(latest.end)}。`;
};

export const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

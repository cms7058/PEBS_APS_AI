# MVP 数据模型草案

## 1. tenants 企业表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 企业 ID |
| name | text | 企业名称 |
| industry | text | 行业：CNC、汽车零部件等 |
| trial_start_at | timestamp | 试用开始时间 |
| trial_end_at | timestamp | 试用结束时间 |
| trial_status | text | active、expired、paid、suspended |
| max_users | int | 最大用户数 |
| max_orders | int | 最大订单数 |
| max_operations | int | 最大工序数 |
| max_resources | int | 最大设备数 |
| created_at | timestamp | 创建时间 |

## 2. users 用户表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 用户 ID |
| tenant_id | uuid | 企业 ID |
| name | text | 姓名 |
| email | text | 邮箱 |
| phone | text | 手机 |
| role | text | admin、planner、viewer |
| status | text | active、disabled |
| created_at | timestamp | 创建时间 |

## 3. orders 订单表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 系统 ID |
| tenant_id | uuid | 企业 ID |
| order_id | text | 客户订单号 |
| customer | text | 客户 |
| part_id | text | 零件号 |
| quantity | int | 数量 |
| due_time | timestamp | 要求交期 |
| priority | int | 优先级 |
| order_type | text | 正式订单、预测、返工 |
| status | text | 状态 |

## 4. routings 工艺路线表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 系统 ID |
| tenant_id | uuid | 企业 ID |
| part_id | text | 零件号 |
| operation_seq | int | 工序顺序 |
| operation_code | text | 工序编码 |
| operation_name | text | 工序名称 |
| predecessor_seq | int | 前置工序 |
| eligible_resources | text[] | 可选设备 |
| setup_minutes | int | 准备时间 |
| run_minutes_per_piece | numeric | 单件加工时间 |
| inspection_minutes | int | 检验时间 |
| outsourcing_flag | boolean | 是否外协 |
| tooling_required | text | 工装需求 |

## 5. resources 设备资源表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 系统 ID |
| tenant_id | uuid | 企业 ID |
| resource_id | text | 设备编号 |
| resource_name | text | 设备名称 |
| resource_type | text | 设备类型 |
| work_center | text | 工作中心 |
| capability_tags | text[] | 能力标签 |
| calendar_id | text | 日历 ID |
| status | text | 可用、停机、维护 |
| alternative_group | text | 替代设备组 |

## 6. resource_calendar 设备日历表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 系统 ID |
| tenant_id | uuid | 企业 ID |
| calendar_id | text | 日历 ID |
| resource_id | text | 可为空，表示通用日历 |
| date | date | 日期 |
| shift_name | text | 班次 |
| start_time | time | 开始时间 |
| end_time | time | 结束时间 |
| available | boolean | 是否可用 |
| overtime_flag | boolean | 是否加班 |

## 7. inventory_status 物料状态表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 系统 ID |
| tenant_id | uuid | 企业 ID |
| material_id | text | 物料编号 |
| material_name | text | 物料名称 |
| available_qty | numeric | 可用库存 |
| required_qty | numeric | 需求数量 |
| available_time | timestamp | 可用时间 |
| substitute_materials | text[] | 替代料 |
| status | text | 齐套、缺料、部分齐套 |

## 8. wip_status 在制品表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 系统 ID |
| tenant_id | uuid | 企业 ID |
| job_id | text | 任务号 |
| order_id | text | 订单号 |
| part_id | text | 零件号 |
| quantity | int | 数量 |
| current_operation_seq | int | 当前工序 |
| completed_qty | int | 已完成数量 |
| remaining_qty | int | 剩余数量 |
| current_resource | text | 当前设备 |
| status | text | 未开工、生产中、暂停、完成 |

## 9. schedule_plans 排产方案表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 方案 ID |
| tenant_id | uuid | 企业 ID |
| name | text | 方案名称 |
| scenario_type | text | 基础排产、插单、停机、缺料 |
| objective | text | 目标函数 |
| status | text | running、completed、failed |
| started_at | timestamp | 开始时间 |
| completed_at | timestamp | 完成时间 |
| kpi_json | jsonb | KPI 结果 |
| created_by | uuid | 创建人 |

## 10. scheduled_operations 排产结果表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 结果 ID |
| tenant_id | uuid | 企业 ID |
| schedule_plan_id | uuid | 方案 ID |
| order_id | text | 订单号 |
| job_id | text | 任务号 |
| part_id | text | 零件号 |
| operation_seq | int | 工序顺序 |
| operation_name | text | 工序名称 |
| resource_id | text | 分配设备 |
| start_time | timestamp | 开始时间 |
| end_time | timestamp | 结束时间 |
| setup_minutes | int | 准备时间 |
| run_minutes | int | 加工时间 |
| delay_minutes | int | 延期时长 |
| delay_reason | text | 延期原因 |

## 11. audit_logs 操作审计表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 日志 ID |
| tenant_id | uuid | 企业 ID |
| user_id | uuid | 用户 ID |
| action | text | 操作 |
| object_type | text | 对象类型 |
| object_id | text | 对象 ID |
| detail_json | jsonb | 操作详情 |
| created_at | timestamp | 创建时间 |

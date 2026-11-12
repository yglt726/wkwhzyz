import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { ExclamationCircleOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { api, errMsg, formatTime } from '../api';

export default function AdminQuotaPage() {
  const [data, setData] = useState<any>(null);
  const [windows, setWindows] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [withdrawTarget, setWithdrawTarget] = useState<any>(null);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [o, w] = await Promise.all([api.get('/admin/overview'), api.get('/admin/windows')]);
      setData(o.data);
      setWindows(w.data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const reconcile = async () => {
    setBusy(true);
    try {
      const res = await api.post('/admin/reconcile', { roundNo: 0 });
      message.success(`对账完成：${res.data.snapshotCount} 位导师快照，新增异常 ${res.data.anomaliesCreated} 条`);
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const runAdjust = (level: number) => {
    Modal.confirm({
      title: `执行 L${level} ${level === 1 ? '实训室内部调剂' : level === 2 ? '全院跨实训室调剂' : '未服从调剂学生最终统筹'}`,
      icon: <SafetyCertificateOutlined />,
      content: '调剂仅在 ADJUST 时间窗内可执行；已录取学生不会被重复分配。',
      okText: '执行',
      onOk: async () => {
        try {
          const res = await api.post('/admin/adjust', { level });
          message.success(`L${level} 完成：新增录取 ${res.data.assigned} 人，剩余名额 ${res.data.remainingFree}`);
          await load();
        } catch (e) {
          message.error(errMsg(e));
        }
      },
    });
  };

  const submitWithdraw = async () => {
    const values = await form.validateFields();
    setBusy(true);
    try {
      await api.post('/admin/withdrawals', {
        offerId: withdrawTarget.id,
        reason: values.reason,
        detail: values.detail ?? '',
      });
      message.success('已登记放弃并释放名额');
      setWithdrawTarget(null);
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const setClock = async (iso: string) => {
    setBusy(true);
    try {
      const res = await api.post('/admin/clock', { now: iso });
      message.success(
        `模拟时间已切换，当前环节：${res.data.stage.activeStageLabel}${res.data.autoConfirmed ? `，自动确认 ${res.data.autoConfirmed} 人` : ''}`,
      );
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const resetClock = async () => {
    setBusy(true);
    try {
      await api.delete('/admin/clock');
      message.success('已恢复真实时间');
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const ledger = data?.ledger;
  const summary = ledger?.summary ?? {};
  const totalQuota = summary.quota ?? 0;
  const totalConfirmed = summary.confirmed ?? 0;
  const totalPending = summary.pending ?? 0;
  const used = totalConfirmed + totalPending;
  const overQuotaMentors = summary.overQuotaMentors ?? 0;
  const overRows: any[] = (ledger?.rows ?? []).filter((r: any) => r.overQuota);
  const overRowsQuota = overRows.reduce((s: number, r: any) => s + r.quota, 0);
  const overRowsConfirmed = overRows.reduce((s: number, r: any) => s + r.confirmed, 0);
  const overallOverRatio =
    overRowsQuota > 0 ? Math.max(0, overRowsConfirmed / overRowsQuota - 1) : 0;
  const clockOptions: { value: string; label: string }[] = (windows?.windows ?? []).map((w: any) => ({
    value: w.startsAt,
    label: `${w.stageLabel}${w.roundNo ? `（R${w.roundNo}）` : ''} · ${formatTime(w.startsAt)}`,
  }));
  const uniqueClockOptions = Array.from(new Map(clockOptions.map((o: any) => [o.value, o])).values());

  return (
    <div>
      <div className="page-head">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 2 }}>
            名额总览与对账
          </Typography.Title>
          <Typography.Text type="secondary">
            名额账本三层：已确认占用 / 待确认预占 / 可释放；每轮对账，差异进入异常记录而不是静默修正。
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" onClick={reconcile} loading={busy} icon={<SafetyCertificateOutlined />}>
            立即对账
          </Button>
        </Space>
      </div>

      <Alert
        style={{ marginBottom: 16 }}
        type={data?.stage?.activeStage && data.stage.activeStage !== 'CLOSED' ? 'success' : 'info'}
        showIcon
        message={`当前环节：${data?.stage?.activeStageLabel ?? '-'} · 模拟时钟 ${formatTime(data?.stage?.now)} · 当前轮次 R${data?.stage?.currentRound ?? '-'}`}
        description={`未解决异常 ${data?.anomalyCount ?? 0} 条。超录、挂起、对账差异都会进入异常列表，公示期可追溯。`}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={5}>
          <Card size="small">
            <Statistic title="总名额" value={totalQuota} suffix="人" />
          </Card>
        </Col>
        <Col xs={12} md={5}>
          <Card size="small">
            <Statistic title="已确认占用" value={totalConfirmed} valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
        <Col xs={12} md={5}>
          <Card size="small">
            <Statistic title="待确认预占" value={totalPending} valueStyle={{ color: '#d46b08' }} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Statistic title="剩余可录" value={summary.free ?? 0} valueStyle={{ color: '#1d39c4' }} />
          </Card>
        </Col>
        <Col xs={12} md={5}>
          <Card size="small">
            <Statistic
              title="超录比例 / 导师"
              value={`${(overallOverRatio * 100).toFixed(0)}%`}
              suffix={`· ${overQuotaMentors} 位`}
              valueStyle={{ color: overQuotaMentors > 0 ? '#d46b08' : '#389e0d' }}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" style={{ marginBottom: 16 }}>
        <div className="quota-row">
          <div className="quota-total">
            <div className="muted-line">全校占用（已确认 + 待预占）</div>
            <div className="quota-total-value">
              {used}
              <span className="quota-total-unit"> / {totalQuota} 人</span>
            </div>
          </div>
          <Progress
            percent={Math.min(100, (used / Math.max(1, totalQuota)) * 100)}
            status={overQuotaMentors > 0 ? 'exception' : 'normal'}
            format={() => `${Math.round((used / Math.max(1, totalQuota)) * 100)}%`}
          />
          <Space wrap size={16} className="quota-legend">
            <span><i className="dot dot-confirmed" />已确认 {totalConfirmed}</span>
            <span><i className="dot dot-pending" />待预占 {totalPending}</span>
            <span><i className="dot dot-free" />剩余 {summary.free ?? 0}</span>
          </Space>
        </div>
        {overQuotaMentors > 0 && (
          <Alert
            style={{ marginTop: 10 }}
            type="warning"
            showIcon
            message={`有 ${overQuotaMentors} 位导师已超录，整体超录比例 ${(overallOverRatio * 100).toFixed(0)}%`}
            description="超录为已拍板的软约束：不影响继续流程，但会标记 over_quota 并写入异常与审计；建议在公示前与学院确认名额调整，勿继续扩大超录。"
          />
        )}
        <div className="muted-line" style={{ marginTop: 8 }}>
          账本口径：已确认 = 已锁定名额；待预占 = 已发拟录取但学生尚未确认；剩余可录 = 名额 - 已确认 - 待预占；超录比例 = 已确认 / 名额 - 1。
        </div>
      </Card>

      <Card size="small" title="导师名额账本" style={{ marginBottom: 16 }}>
        <Table
          rowKey="mentorId"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={ledger?.rows ?? []}
          scroll={{ x: 1180 }}
          rowClassName={(r: any) => (r.overQuota ? 'row-overquota' : '')}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无导师名额数据" />,
          }}
          columns={[
            { title: '实训室', dataIndex: 'labName', width: 180, ellipsis: true },
            { title: '导师', dataIndex: 'mentorName', width: 100 },
            {
              title: '名额',
              dataIndex: 'quota',
              width: 70,
              align: 'right',
            },
            {
              title: '已确认',
              dataIndex: 'confirmed',
              width: 90,
              align: 'right',
              render: (v: number, r: any) => (
                <strong style={{ color: r.overQuota ? '#d46b08' : '#1f7a3f' }}>{v}</strong>
              ),
            },
            {
              title: '待预占',
              dataIndex: 'pending',
              width: 90,
              align: 'right',
              render: (v: number) => <span style={{ color: v > 0 ? '#d46b08' : undefined }}>{v}</span>,
            },
            {
              title: '剩余可录',
              dataIndex: 'free',
              width: 90,
              align: 'right',
              render: (v: number) => <span style={{ color: v > 0 ? '#1d39c4' : '#8c8c8c' }}>{v}</span>,
            },
            {
              title: '占用进度',
              width: 190,
              render: (_: any, r: any) => {
                const percent = Math.min(100, (r.confirmed / Math.max(1, r.quota)) * 100);
                return (
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <Progress percent={percent} status={r.overQuota ? 'exception' : 'normal'} size="small" format={() => `${r.confirmed}/${r.quota}`} />
                    <span className="muted-line">
                      {r.overQuota ? `超录 ${r.confirmed - r.quota} 人` : r.free === 0 ? '名额已满' : `还可录 ${r.free} 人`}
                    </span>
                  </Space>
                );
              },
            },
            {
              title: '超录比例',
              dataIndex: 'overRatio',
              width: 100,
              render: (v: number) => (v > 0 ? <Tag color="orange">+{(v * 100).toFixed(0)}%</Tag> : <span className="muted-line">-</span>),
            },
            {
              title: '状态',
              width: 100,
              render: (_: any, r: any) =>
                r.overQuota ? (
                  <Tag color="orange">超录</Tag>
                ) : r.free === 0 ? (
                  <Tag color="blue">满额</Tag>
                ) : (
                  <Tag color="green">正常</Tag>
                ),
            },
            { title: '递补排队', dataIndex: 'waitlistPending', width: 90, align: 'right' },
            { title: '已释放', dataIndex: 'released', width: 80, align: 'right' },
          ]}
        />
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="统筹调剂（三级优先级）">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button block onClick={() => runAdjust(1)}>
                L1 实训室内部调剂（按学生去重）
              </Button>
              <Button block onClick={() => runAdjust(2)}>
                L2 全院跨实训室调剂
              </Button>
              <Button block onClick={() => runAdjust(3)}>
                L3 未服从调剂学生最终统筹
              </Button>
              <Typography.Text type="secondary">
                仅在 ADJUST 窗口（11/6 08:00–12:00）可执行；结果与明细见「调剂与公示」。
              </Typography.Text>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="演练时钟（服务端唯一权威）">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text>
                当前模拟时间：<strong>{formatTime(data?.stage?.now)}</strong>
              </Typography.Text>
              <Select
                style={{ width: '100%' }}
                placeholder="跳到某个环节开始时间"
                options={uniqueClockOptions}
                onChange={(v) => void setClock(v)}
                showSearch
              />
              <Button onClick={resetClock} loading={busy}>
                恢复真实时间
              </Button>
              <Typography.Text type="secondary">
                切换时钟会立即触发确认窗内的自动确认/到期失效任务；所有时间校验由后端判定。
              </Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="已确认录取（可登记放弃并释放名额）">
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 8 }}
          dataSource={data?.confirmedOffers ?? []}
          scroll={{ x: 900 }}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已确认录取记录" />,
          }}
          columns={[
            { title: '学生', dataIndex: 'studentName', width: 100 },
            { title: '学号', dataIndex: 'studentNo', width: 110 },
            { title: '实训室', dataIndex: 'labName' },
            { title: '导师', dataIndex: 'mentorName', width: 100 },
            { title: '类型', dataIndex: 'kindLabel', width: 100 },
            {
              title: '标记',
              width: 140,
              render: (_: any, r: any) => (
                <Space size={4}>
                  {r.autoConfirmed && <Tag color="cyan">自动</Tag>}
                  {r.overQuota && <Tag color="red">超发</Tag>}
                </Space>
              ),
            },
            { title: '确认时间', dataIndex: 'decidedAt', render: (v: string) => formatTime(v) },
            {
              title: '操作',
              width: 110,
              render: (_: any, r: any) => (
                <Button
                  danger
                  type="link"
                  onClick={() => {
                    setWithdrawTarget(r);
                    form.setFieldsValue({ reason: 'CONFIRM_ABANDON', detail: '' });
                  }}
                >
                  登记放弃
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Card size="small" title="放弃/释放记录" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data?.withdrawals ?? []}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无放弃/释放记录" />,
          }}
          columns={[
            { title: '学生', dataIndex: 'studentName', width: 100 },
            { title: '导师', dataIndex: 'mentorName', width: 100 },
            { title: '原因', dataIndex: 'reasonLabel', width: 140 },
            { title: '说明', dataIndex: 'detail' },
            { title: '时间', dataIndex: 'createdAt', render: (v: string) => formatTime(v) },
          ]}
        />
      </Card>

      <Modal
        open={Boolean(withdrawTarget)}
        title={`登记放弃 · ${withdrawTarget?.studentName ?? ''}`}
        okText="确认放弃并释放名额"
        okButtonProps={{ danger: true, loading: busy }}
        onCancel={() => setWithdrawTarget(null)}
        onOk={submitWithdraw}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="不删除任何记录"
          description="系统会保留原拟录取记录，新增 withdrawal 记录并释放名额；学生回到补录/调剂池。确认窗内若仍有递补名单，会自动按顺位补录。"
        />
        <Form form={form} layout="vertical">
          <Form.Item label="放弃原因" name="reason" rules={[{ required: true, message: '请选择放弃原因（如确认后放弃/公示后放弃/入组未报到）' }]}>
            <Select
              options={[
                { value: 'CONFIRM_ABANDON', label: '确认后放弃' },
                { value: 'PUBLICITY_ABANDON', label: '公示后放弃' },
                { value: 'NO_SHOW', label: '入组未报到' },
                { value: 'ADMIN_RELEASE', label: '管理员人工释放' },
              ]}
            />
          </Form.Item>
          <Form.Item label="备注" name="detail">
            <Input.TextArea rows={2} placeholder="如：学生电话告知已选择其他方向" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

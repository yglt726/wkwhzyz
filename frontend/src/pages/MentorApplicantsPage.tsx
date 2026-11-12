import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Segmented,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errMsg, formatTime } from '../api';
import { useAuth } from '../auth';

const ROUND_OPTIONS = [
  { label: '第一轮', value: 1 },
  { label: '第二轮补录', value: 2 },
  { label: '第三轮补录', value: 3 },
];

export default function MentorApplicantsPage() {
  const { user } = useAuth();
  const [roundNo, setRoundNo] = useState(1);
  const [data, setData] = useState<any>(null);
  const [bootstrap, setBootstrap] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saveMode, setSaveMode] = useState<'close' | 'next'>('close');
  const [form] = Form.useForm();

  const load = useCallback(
    async (rn: number) => {
      setLoading(true);
      try {
        const [a, b] = await Promise.all([
          api.get('/mentor/applicants', { params: { roundNo: rn } }),
          api.get('/meta/bootstrap', { params: { roundNo: rn } }),
        ]);
        setData(a.data);
        setBootstrap(b.data);
        return a.data;
      } catch (e) {
        message.error(errMsg(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(roundNo);
  }, [roundNo, load]);

  const rows = data?.rows ?? [];
  const scoredCount = rows.filter((r: any) => Boolean(r.interview)).length;
  const pendingCount = rows.length - scoredCount;
  const percent = rows.length === 0 ? 0 : Math.round((scoredCount / rows.length) * 100);

  const weights = bootstrap?.interviewWeights ?? { attitude: 30, logic: 25, coding: 30, timeInvest: 15 };
  const now = bootstrap?.stage?.now ? new Date(bootstrap.stage.now).getTime() : Date.now();
  const interviewWindow = data?.interviewWindow;
  const interviewOpen = Boolean(
    interviewWindow &&
      new Date(interviewWindow.startsAt).getTime() <= now &&
      new Date(interviewWindow.endsAt).getTime() >= now,
  );
  const quota = data?.quota;

  const fillForm = (row: any) => {
    form.setFieldsValue({
      attitude: row.interview?.attitude ?? 80,
      logic: row.interview?.logic ?? 80,
      coding: row.interview?.coding ?? 80,
      timeInvest: row.interview?.timeInvest ?? 80,
      absent: row.interview?.status === 'ABSENT',
      remark: row.interview?.remark ?? '',
    });
  };

  const openScore = (row: any) => {
    setEditing(row);
    fillForm(row);
  };

  const nextRowOf = (currentId: string, latestRows: any[]) => {
    const idx = latestRows.findIndex((r) => r.studentId === currentId);
    if (idx < 0) return latestRows.find((r) => !r.interview) ?? null;
    for (let step = 1; step <= latestRows.length; step += 1) {
      const cand = latestRows[(idx + step) % latestRows.length];
      if (cand && !cand.interview) return cand;
    }
    return null;
  };

  const submitScore = async (mode: 'close' | 'next') => {
    setSaveMode(mode);
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      message.warning('请先补全四个维度分数，或打开「是否缺考」');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/mentor/interviews/score', {
        studentId: editing.studentId,
        roundNo,
        attitude: values.absent ? undefined : values.attitude,
        logic: values.absent ? undefined : values.logic,
        coding: values.absent ? undefined : values.coding,
        timeInvest: values.absent ? undefined : values.timeInvest,
        absent: values.absent,
        remark: values.remark ?? '',
      });
      const latest = await load(roundNo);
      const latestRows = latest?.rows ?? rows;
      const left = latestRows.filter((r: any) => !r.interview).length;
      if (mode === 'next') {
        const next = nextRowOf(editing.studentId, latestRows);
        if (!next) {
          message.success(`已保存 ${editing.name}，本室全部学生已完成评分`);
          setEditing(null);
        } else {
          message.success(`已保存 ${editing.name}，还剩 ${left} 人待评分`);
          setEditing(next);
          fillForm(next);
        }
      } else {
        message.success(`已保存 ${editing.name} 的评分`);
        setEditing(null);
      }
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  const modalTitle = useMemo(
    () => (
      <div className="score-modal-title">
        <span>
          面试评分 · {editing?.name ?? ''}{' '}
          <Typography.Text type="secondary">
            {editing?.studentNo ?? ''} · 已评分 {scoredCount}/{rows.length}
          </Typography.Text>
        </span>
        <Tag color={pendingCount === 0 ? 'green' : 'orange'}>{pendingCount === 0 ? '全部完成' : `还剩 ${pendingCount} 人`}</Tag>
      </div>
    ),
    [editing, scoredCount, rows.length, pendingCount],
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 2 }}>
            面试评分
          </Typography.Title>
          <Typography.Text type="secondary">
            {data?.labName} · {user?.name} · 本实训室所有报名学生均须参加面试，同室导师共享评分。
          </Typography.Text>
        </div>
        <Segmented options={ROUND_OPTIONS} value={roundNo} onChange={(v) => setRoundNo(v as number)} />
      </div>

      <Alert
        style={{ marginBottom: 16 }}
        type={interviewOpen ? 'success' : 'warning'}
        showIcon
        message={
          interviewOpen
            ? `面试考核进行中：${formatTime(interviewWindow?.startsAt)} ~ ${formatTime(interviewWindow?.endsAt)}`
            : '当前不在面试评分时间窗内，评分提交将被服务端拒绝（展示仅供查阅）'
        }
        description={
          interviewOpen
            ? '完成本室所有学生评分后，才能提交拟录取名单；请优先处理「未评分」学生。'
            : undefined
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="我的名额" value={quota?.quota ?? 0} suffix="人" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="已确认占用"
              value={quota?.confirmed ?? 0}
              valueStyle={{ color: quota?.overQuota ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="待确认预占" value={quota?.pending ?? 0} valueStyle={{ color: '#d46b08' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="剩余可录" value={quota?.free ?? 0} valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={`本实训室报名学生（${rows.length} 人）`}
        extra={
          <Space size={10}>
            <Tag color={pendingCount ? 'orange' : 'green'}>
              已评分 {scoredCount}/{rows.length}
            </Tag>
            <Progress
              percent={percent}
              size="small"
              style={{ width: 160, marginBottom: 0 }}
              status={pendingCount ? 'active' : 'success'}
            />
          </Space>
        }
      >
        {rows.length === 0 ? (
          <div className="empty-block">本室本轮暂无报名学生</div>
        ) : (
          <Table
            rowKey="studentId"
            loading={loading}
            size="small"
            dataSource={rows}
            scroll={{ x: 980 }}
            pagination={false}
            rowClassName={(r: any) => (r.interview ? '' : 'row-unscored')}
            columns={[
              {
                title: '学生',
                dataIndex: 'name',
                width: 110,
                render: (v: string, r: any) => (
                  <Space direction="vertical" size={0}>
                    <strong>{v}</strong>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.studentNo}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: '是否报我',
                dataIndex: 'appliedToMe',
                width: 110,
                render: (v: boolean) => (v ? <Tag color="blue">报我</Tag> : <Tag>报同室其他导师</Tag>),
              },
              { title: '同室志愿数', dataIndex: 'intentMentorCount', width: 100 },
              {
                title: '面试状态',
                dataIndex: 'interview',
                width: 100,
                render: (v: any) =>
                  !v ? <Tag color="orange">未评分</Tag> : v.status === 'ABSENT' ? <Tag color="red">缺考</Tag> : <Tag color="green">已评分</Tag>,
              },
              {
                title: '四维评分',
                width: 210,
                render: (_: any, r: any) =>
                  r.interview?.status === 'SCORED' ? (
                    <Space size={4} wrap>
                      <Tag>态度 {r.interview.attitude}</Tag>
                      <Tag>逻辑 {r.interview.logic}</Tag>
                      <Tag>编程 {r.interview.coding}</Tag>
                      <Tag>投入 {r.interview.timeInvest}</Tag>
                    </Space>
                  ) : (
                    '-'
                  ),
              },
              {
                title: '总分',
                dataIndex: 'interview',
                width: 80,
                render: (v: any) => (v?.total != null ? <strong>{v.total}</strong> : '-'),
              },
              {
                title: '调剂意愿',
                width: 140,
                render: (_: any, r: any) => (
                  <Space size={4}>
                    {r.acceptLabAdjust && <Tag color="cyan">室内</Tag>}
                    {r.acceptCollegeAdjust && <Tag color="geekblue">全院</Tag>}
                    {!r.acceptLabAdjust && !r.acceptCollegeAdjust && <Tag>不服从</Tag>}
                  </Space>
                ),
              },
              {
                title: '操作',
                width: 110,
                fixed: 'right',
                render: (_: any, r: any) => (
                  <Button
                    type={r.interview ? 'link' : 'primary'}
                    size={r.interview ? 'small' : 'middle'}
                    ghost={!r.interview}
                    disabled={!interviewOpen}
                    onClick={() => openScore(r)}
                  >
                    {r.interview ? '修改评分' : '立即评分'}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="评分 → 提交名单"
        description="弹窗内可用 Ctrl+Enter 保存并自动跳到下一位未评分学生，不必反复返回列表。完成本室所有报名学生评分后，前往「名额与名单」提交拟录取与递补名单。"
      />

      <Modal
        open={Boolean(editing)}
        title={modalTitle}
        width={600}
        maskClosable={false}
        confirmLoading={submitting}
        onCancel={() => setEditing(null)}
        footer={[
          <Button key="close" onClick={() => setEditing(null)} disabled={submitting}>
            取消
          </Button>,
          <Button key="save" onClick={() => void submitScore('close')} loading={submitting && saveMode === 'close'}>
            仅保存
          </Button>,
          <Button
            key="next"
            type="primary"
            onClick={() => void submitScore('next')}
            loading={submitting && saveMode === 'next'}
          >
            保存并评下一位
          </Button>,
        ]}
      >
        <div
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') {
              e.preventDefault();
              void submitScore('next');
            }
          }}
        >
          <div className="score-progress">
            <Progress percent={percent} size="small" status={pendingCount ? 'active' : 'success'} />
            <Typography.Text type="secondary">
              本室进度 {scoredCount}/{rows.length}
              {pendingCount > 0 ? `，还剩 ${pendingCount} 人` : '，全部完成'}
            </Typography.Text>
            <Tag icon={<KeyOutlined />}>Ctrl+Enter 保存并下一位</Tag>
          </div>
          <Form form={form} layout="vertical" requiredMark="optional">
            <Form.Item label="是否缺考" name="absent" valuePropName="checked">
              <Switch checkedChildren="缺考" unCheckedChildren="参加面试" />
            </Form.Item>
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) =>
                !getFieldValue('absent') && (
                  <Row gutter={12}>
                    <Col xs={12}>
                      <Form.Item
                        label={`学习态度（权重 ${weights.attitude}%）`}
                        name="attitude"
                        rules={[
                          { required: true, message: '请输入学习态度分数（0-100）' },
                          { type: 'number', min: 0, max: 100, message: '学习态度需在 0-100 之间' },
                        ]}
                      >
                        <InputNumber min={0} max={100} style={{ width: '100%' }} autoFocus />
                      </Form.Item>
                    </Col>
                    <Col xs={12}>
                      <Form.Item
                        label={`逻辑思维（权重 ${weights.logic}%）`}
                        name="logic"
                        rules={[
                          { required: true, message: '请输入逻辑思维分数（0-100）' },
                          { type: 'number', min: 0, max: 100, message: '逻辑思维需在 0-100 之间' },
                        ]}
                      >
                        <InputNumber min={0} max={100} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12}>
                      <Form.Item
                        label={`编程基础（权重 ${weights.coding}%）`}
                        name="coding"
                        rules={[
                          { required: true, message: '请输入编程基础分数（0-100）' },
                          { type: 'number', min: 0, max: 100, message: '编程基础需在 0-100 之间' },
                        ]}
                      >
                        <InputNumber min={0} max={100} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12}>
                      <Form.Item
                        label={`时间投入（权重 ${weights.timeInvest}%）`}
                        name="timeInvest"
                        rules={[
                          { required: true, message: '请输入时间投入分数（0-100）' },
                          { type: 'number', min: 0, max: 100, message: '时间投入需在 0-100 之间' },
                        ]}
                      >
                        <InputNumber min={0} max={100} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                )
              }
            </Form.Item>
            <Form.Item label="评语（可选）" name="remark">
              <Input.TextArea rows={2} placeholder="面试表现、培养潜力等" />
            </Form.Item>
            <Alert type="info" showIcon message="总分由服务端按权重自动计算，前端不提交总分。" />
          </Form>
        </div>
      </Modal>
    </div>
  );
}

import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
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
} from 'antd';
import { DownloadOutlined, KeyOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errMsg, formatTime } from '../api';
import { useAuth } from '../auth';

const ROUND_OPTIONS = [
  { label: '第一轮', value: 1 },
  { label: '第二轮补录', value: 2 },
  { label: '第三轮补录', value: 3 },
];

export default function MentorApplicantsPage() {
  const { message } = App.useApp();
  const { user } = useAuth();
  const [roundNo, setRoundNo] = useState(1);
  const [data, setData] = useState<any>(null);
  const [bootstrap, setBootstrap] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [detailRow, setDetailRow] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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

  const openDetail = async (row: any) => {
    setDetailRow(row);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await api.get(`/mentor/students/${row.studentId}`, { params: { roundNo } });
      setDetail(res.data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const downloadStudentResume = async () => {
    if (!detailRow) return;
    try {
      const res = await api.get(`/mentor/students/${detailRow.studentId}/resume`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = detail?.profile?.resume?.name || '简历';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(errMsg(e));
    }
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
          message.success(`已保存 ${editing.name}，填报我的学生已全部完成评分`);
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
            {data?.labName} · {user?.name} · 只显示填报我的学生；同一学生报同室多位导师时，各位导师分别独立打分，互不覆盖。
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
            ? '面试考核进行中：请按维度评分后提交'
            : '当前阶段不可评分，评分提交将被拒绝（展示仅供查阅）'
        }
        description={
          interviewOpen
            ? '完成填报我的全部学生评分后，才能提交拟录取名单；请优先处理「未评分」学生。'
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
        title={`填报我的学生（${rows.length} 人）`}
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
          <div className="empty-block">本轮暂无学生填报你</div>
        ) : (
          <Table
            rowKey="studentId"
            loading={loading}
            size="small"
            dataSource={rows}
            scroll={{ x: 1040 }}
            pagination={false}
            rowClassName={(r: any) => (r.interview ? '' : 'row-unscored')}
            columns={[
              {
                title: '学生',
                dataIndex: 'name',
                width: 150,
                render: (v: string, r: any) => (
                  <Space direction="vertical" size={0}>
                    <strong>{v}</strong>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.studentNo}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.major || '-'} · {r.className || '-'}
                    </Typography.Text>
                  </Space>
                ),
              },
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
                width: 170,
                fixed: 'right',
                render: (_: any, r: any) => (
                  <Space size={4}>
                    <Button size="small" type="link" onClick={() => void openDetail(r)}>
                      查看信息
                    </Button>
                    <Button
                      type={r.interview ? 'link' : 'primary'}
                      size={r.interview ? 'small' : 'middle'}
                      ghost={!r.interview}
                      disabled={!interviewOpen}
                      onClick={() => openScore(r)}
                    >
                      {r.interview ? '修改评分' : '评分'}
                    </Button>
                  </Space>
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
        description="弹窗内可用 Ctrl+Enter 保存并自动跳到下一位未评分学生，不必反复返回列表。完成填报我的学生评分后，前往「名额与名单」提交拟录取与递补名单；同室其他导师的评分互不影响。"
      />

      <Drawer
        open={Boolean(detailRow)}
        onClose={() => {
          setDetailRow(null);
          setDetail(null);
        }}
        width={560}
        loading={detailLoading}
        title={`学生信息 · ${detailRow?.name ?? ''}`}
        footer={
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              onClick={() => {
                setDetailRow(null);
                setDetail(null);
              }}
            >
              关闭
            </Button>
            <Button
              type="primary"
              disabled={!interviewOpen}
              onClick={() => {
                const row = detailRow;
                setDetailRow(null);
                setDetail(null);
                openScore(row);
              }}
            >
              {detailRow?.interview ? '修改评分' : '去评分'}
            </Button>
          </Space>
        }
      >
        {detail && (
          <>
            <Descriptions
              size="small"
              column={2}
              bordered
              items={[
                { key: 'name', label: '姓名', children: detail.student.name },
                { key: 'studentNo', label: '学号', children: detail.student.studentNo || '-' },
                { key: 'major', label: '专业', children: detail.profile?.major || '-' },
                { key: 'className', label: '班级', children: detail.profile?.className || '-' },
                { key: 'gpa', label: '绩点', children: detail.profile?.gpa ?? '-' },
                {
                  key: 'rank',
                  label: '专业排名',
                  children:
                    detail.profile?.rankNo && detail.profile?.rankTotal
                      ? `${detail.profile.rankNo}/${detail.profile.rankTotal}`
                      : '-',
                },
                { key: 'phone', label: '手机', children: detail.profile?.phone || '-' },
                { key: 'email', label: '邮箱', children: detail.profile?.email || '-' },
              ]}
            />

            <Divider style={{ margin: '16px 0 12px' }} />
            <Typography.Title level={5} style={{ marginBottom: 8 }}>
              个人简介
            </Typography.Title>
            <Typography.Paragraph type={detail.profile?.intro ? undefined : 'secondary'}>
              {detail.profile?.intro || '学生暂未填写个人简介'}
            </Typography.Paragraph>

            <Divider style={{ margin: '16px 0 12px' }} />
            <Typography.Title level={5} style={{ marginBottom: 8 }}>
              个人简历
            </Typography.Title>
            {detail.profile?.resume ? (
              <Space size={10} wrap>
                <Typography.Text strong>{detail.profile.resume.name}</Typography.Text>
                <Typography.Text type="secondary">
                  {detail.profile.resume.size
                    ? `${Math.round(detail.profile.resume.size / 1024)} KB`
                    : '-'}
                </Typography.Text>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => void downloadStudentResume()}>
                  查看 / 下载
                </Button>
              </Space>
            ) : (
              <Typography.Text type="secondary">学生尚未上传简历</Typography.Text>
            )}

            <Divider style={{ margin: '16px 0 12px' }} />
            <Typography.Title level={5} style={{ marginBottom: 8 }}>
              本轮志愿（{detail.intents.length}）
            </Typography.Title>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {detail.intents.map((it: any, idx: number) => (
                <div key={it.mentorId} className="detail-intent-row">
                  <span>
                    <Typography.Text type="secondary">{idx + 1}.</Typography.Text>{' '}
                    <strong>{it.mentorName}</strong>
                    {it.mentorTitle ? ` · ${it.mentorTitle}` : ''}
                    <Typography.Text type="secondary">（{it.labName}）</Typography.Text>
                  </span>
                  {it.appliedToMe && <Tag color="blue">报我</Tag>}
                </div>
              ))}
            </Space>

            <Divider style={{ margin: '16px 0 12px' }} />
            <Typography.Title level={5} style={{ marginBottom: 8 }}>
              调剂意愿
            </Typography.Title>
            <Space size={6}>
              {detail.application?.acceptLabAdjust && <Tag color="cyan">服从室内调剂</Tag>}
              {detail.application?.acceptCollegeAdjust && <Tag color="geekblue">服从全院调剂</Tag>}
              {!detail.application?.acceptLabAdjust && !detail.application?.acceptCollegeAdjust && <Tag>不服从调剂</Tag>}
            </Space>

            <Divider style={{ margin: '16px 0 12px' }} />
            <Typography.Title level={5} style={{ marginBottom: 8 }}>
              面试评分
            </Typography.Title>
            {!detail.interview ? (
              <Alert type="warning" showIcon message="尚未评分" description="可在本页底部点击「去评分」完成打分。" />
            ) : detail.interview.status === 'ABSENT' ? (
              <Alert
                type="error"
                showIcon
                message="已登记缺考"
                description={detail.interview.remark || undefined}
              />
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space size={6} wrap>
                  <Tag>态度 {detail.interview.attitude}</Tag>
                  <Tag>逻辑 {detail.interview.logic}</Tag>
                  <Tag>编程 {detail.interview.coding}</Tag>
                  <Tag>投入 {detail.interview.timeInvest}</Tag>
                  <Tag color="green">总分 {detail.interview.total}</Tag>
                </Space>
                <Typography.Paragraph style={{ marginBottom: 0 }} type="secondary">
                  评语：{detail.interview.remark || '无'}
                  {detail.interview.scoredAt ? ` · 评分时间 ${formatTime(detail.interview.scoredAt)}` : ''}
                </Typography.Paragraph>
              </Space>
            )}
          </>
        )}
      </Drawer>

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
              我的评分进度 {scoredCount}/{rows.length}
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

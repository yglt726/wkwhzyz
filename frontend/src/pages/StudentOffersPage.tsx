import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Modal,
  Row,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { api, errMsg, formatCountdown, formatTime } from '../api';

const ROUND_OPTIONS = [
  { label: '第一轮', value: 1 },
  { label: '第二轮补录', value: 2 },
  { label: '第三轮补录', value: 3 },
];

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'orange',
  CONFIRMED: 'green',
  DECLINED: 'default',
  EXPIRED: 'red',
  VOID: 'default',
  WITHDRAWN: 'volcano',
  CANCELLED: 'default',
};

export default function StudentOffersPage() {
  const [data, setData] = useState<any>(null);
  const [roundNo, setRoundNo] = useState<number>(1);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [target, setTarget] = useState<any>(null);
  const [ack, setAck] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async (rn?: number) => {
    setLoading(true);
    try {
      const res = await api.get('/student/offers', { params: rn ? { roundNo: rn } : undefined });
      setData(res.data);
      setRoundNo(res.data.roundNo);
      if (res.data.serverNow) {
        setServerOffset(new Date(res.data.serverNow).getTime() - Date.now());
      }
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = (data?.offers ?? []).filter((o: any) => o.status === 'PENDING' && o.kind !== 'WAITLIST');
  const waitlist = (data?.offers ?? []).filter((o: any) => o.kind === 'WAITLIST' && o.status === 'PENDING');
  const history = (data?.offers ?? []).filter(
    (o: any) => !(o.status === 'PENDING' && o.kind !== 'WAITLIST') && !(o.kind === 'WAITLIST' && o.status === 'PENDING'),
  );

  const remainOf = (offer: any) =>
    offer.expiresAt ? new Date(offer.expiresAt).getTime() - (Date.now() + serverOffset) : 0;

  const earliest = pending
    .slice()
    .sort((a: any, b: any) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0];
  const heroRemain = earliest ? remainOf(earliest) : 0;

  const doConfirm = async () => {
    if (!target) return;
    setActionLoading(true);
    try {
      await api.post(`/student/offers/${target.id}/confirm`);
      message.success('确认成功，名额已锁定，其余待确认意向已全部失效');
      setTarget(null);
      await load(roundNo);
    } catch (e) {
      message.error(errMsg(e));
      await load(roundNo);
    } finally {
      setActionLoading(false);
    }
  };

  const doDecline = (offer: any) => {
    Modal.confirm({
      title: '确认拒绝该拟录取？',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>
            {offer.labName} / {offer.mentorName}
          </p>
          <p style={{ color: '#8c8c8c' }}>拒绝后该名额将按顺位递补给下一位同学，此操作不可撤销。</p>
        </div>
      ),
      okText: '拒绝并释放',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.post(`/student/offers/${offer.id}/decline`);
          message.success('已拒绝该拟录取');
          await load(roundNo);
        } catch (e) {
          message.error(errMsg(e));
          await load(roundNo);
        }
      },
    });
  };

  const compareRows = pending;

  return (
    <div>
      <div className="page-head">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 2 }}>
            我的录取
          </Typography.Title>
          <Typography.Text type="secondary">
            只有 1 个拟录取时系统已立即自动确认；2 个及以上需自主选择唯一去向，先确认先锁定。
          </Typography.Text>
        </div>
        <Segmented options={ROUND_OPTIONS} value={roundNo} onChange={(v) => void load(v as number)} />
      </div>

      {initialized && !data?.published && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message="本轮拟录取结果尚未公布"
          description={
            data?.confirmWindow
              ? `结果将在 ${formatTime(data.confirmWindow.startsAt)} 公布，确认窗口 ${formatTime(
                  data.confirmWindow.startsAt,
                )} ~ ${formatTime(data.confirmWindow.endsAt)}。`
              : '确认时间窗未配置，请联系管理员。'
          }
        />
      )}

      {data?.placement && (
        <Card className="placement-card" style={{ marginBottom: 16 }}>
          <Space size={14} align="center">
            <CheckCircleFilled style={{ fontSize: 36, color: '#95de64' }} />
            <div>
              <div className="placement-eyebrow">已确认去向 · 名额已锁定</div>
              <div className="placement-title">
                {data.placement.labName} / {data.placement.mentorName}
              </div>
              <div className="placement-meta">
                {data.placement.kindLabel} · 第 {data.placement.roundNo} 轮 · 确认时间{' '}
                {formatTime(data.placement.decidedAt)}
              </div>
            </div>
          </Space>
        </Card>
      )}

      <Spin spinning={loading}>
        {data?.published && pending.length > 0 && (
          <div className={`confirm-hero ${heroRemain < 3600000 ? 'is-urgent' : ''}`}>
            <div className="confirm-hero-main">
              <div className="hero-label">
                <ThunderboltFilled /> 确认倒计时 · 先确认先锁定名额
              </div>
              <div className="hero-digits">{formatCountdown(heroRemain)}</div>
              <div className="hero-sub">
                最早截止 {formatTime(earliest?.expiresAt)} · 你还有 <strong>{pending.length}</strong> 个待确认意向
              </div>
            </div>
            <div className="confirm-hero-side">
              <div className="hero-warn">确认其中一个后，其余 {pending.length - 1} 个将立即失效</div>
              <div className="muted-line">请先对比下方全部意向，再点「确认去这里」</div>
            </div>
          </div>
        )}

        {data?.published && pending.length === 0 && waitlist.length === 0 && !data?.placement && (
          <Empty description="本轮没有待确认的拟录取" style={{ margin: '48px 0' }} />
        )}

        <Row gutter={[16, 16]}>
          {pending.map((offer: any) => {
            const remainMs = remainOf(offer);
            const urgent = remainMs < 3600000;
            return (
              <Col xs={24} xl={12} key={offer.id}>
                <Card
                  className={`offer-card ${urgent ? 'offer-card-urgent' : ''}`}
                  title={
                    <Space wrap>
                      <span>{offer.labName}</span>
                      <Typography.Text type="secondary">/ {offer.mentorName}</Typography.Text>
                    </Space>
                  }
                  extra={<Tag color="blue">第 {offer.roundNo} 轮</Tag>}
                >
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color="blue">{offer.kindLabel}</Tag>
                      <Tag color="orange">{offer.statusLabel}</Tag>
                      {offer.overQuota ? <Tag color="red">超发名额</Tag> : <Tag color="green">名额内</Tag>}
                    </Space>
                    <div className={`countdown-box ${urgent ? 'is-urgent' : ''}`}>
                      <div>
                        <div className="countdown-label">
                          <ClockCircleOutlined /> 确认剩余时间
                        </div>
                        <div className="countdown-value">{formatCountdown(remainMs)}</div>
                      </div>
                      <div className="countdown-deadline">截止 {formatTime(offer.expiresAt)}</div>
                    </div>
                    <Alert
                      type="warning"
                      showIcon
                      message={`确认后立即锁定名额、不可撤销；你的其余 ${pending.length - 1} 个待确认意向会同时失效。`}
                    />
                    <Space wrap>
                      <Button
                        type="primary"
                        size="large"
                        danger
                        disabled={remainMs <= 0}
                        onClick={() => {
                          setTarget(offer);
                          setAck(false);
                        }}
                      >
                        确认去这里
                      </Button>
                      <Button onClick={() => doDecline(offer)}>拒绝</Button>
                    </Space>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>

        {waitlist.length > 0 && (
          <Card size="small" title="递补排队（尚未转为拟录取）" style={{ marginTop: 16 }}>
            <Space wrap>
              {waitlist.map((o: any) => (
                <Tag key={o.id} color="purple">
                  {o.labName} / {o.mentorName}
                  {o.rank != null ? ` · 第 ${o.rank} 顺位` : ''}
                </Tag>
              ))}
            </Space>
            <div className="muted-line" style={{ marginTop: 8 }}>
              若前序录取被放弃或逾期未确认，将按顺位自动递补；递补后若仅 1 个拟录取会立即自动确认。
            </div>
          </Card>
        )}

        {history.length > 0 && (
          <Card size="small" title="本轮历史记录" style={{ marginTop: 16 }}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={history}
              scroll={{ x: 720 }}
              columns={[
                { title: '实训室', dataIndex: 'labName' },
                { title: '导师', dataIndex: 'mentorName' },
                { title: '类型', dataIndex: 'kindLabel' },
                {
                  title: '状态',
                  dataIndex: 'status',
                  render: (v: string, r: any) => <Tag color={STATUS_COLOR[v]}>{r.statusLabel}</Tag>,
                },
                { title: '时间', dataIndex: 'decidedAt', render: (v: string) => formatTime(v) },
                { title: '说明', dataIndex: 'note' },
              ]}
            />
          </Card>
        )}
      </Spin>

      <Modal
        open={Boolean(target)}
        title="不可逆确认：锁定唯一去向"
        width={760}
        okText="我已知晓，确认锁定"
        cancelText="再想想"
        okButtonProps={{ danger: true, disabled: !ack, loading: actionLoading }}
        onCancel={() => setTarget(null)}
        onOk={doConfirm}
        maskClosable={false}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="error"
            showIcon
            message="确认后不可撤销"
            description={`你确认后，该名额立即被锁定；本轮其余 ${
              Math.max(0, compareRows.length - 1)
            } 个待确认意向会立即全部失效。如后续放弃，将由管理员登记放弃并回到补录池，可能影响入组资格。`}
          />

          <div className="compare-title">你当前的所有待确认意向（请对比后再选）</div>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={compareRows}
            rowClassName={(r: any) => (r.id === target?.id ? 'compare-target' : '')}
            columns={[
              {
                title: '选择',
                width: 70,
                render: (_: any, r: any) => (r.id === target?.id ? <Tag color="blue">本次确认</Tag> : '-'),
              },
              { title: '实训室', dataIndex: 'labName' },
              { title: '导师', dataIndex: 'mentorName' },
              { title: '类型', dataIndex: 'kindLabel', width: 110 },
              {
                title: '名额',
                width: 90,
                render: (_: any, r: any) =>
                  r.overQuota ? <Tag color="red">超发</Tag> : <Tag color="green">名额内</Tag>,
              },
              {
                title: '截止',
                width: 170,
                render: (_: any, r: any) => formatTime(r.expiresAt),
              },
            ]}
          />

          <Card size="small" className="confirm-target">
            <div className="confirm-target-row">
              <span>确认去向</span>
              <strong>
                {target?.labName} / {target?.mentorName}
              </strong>
            </div>
            <div className="confirm-target-row">
              <span>意向类型</span>
              <span>{target?.kindLabel}</span>
            </div>
            <div className="confirm-target-row">
              <span>确认截止</span>
              <span>{formatTime(target?.expiresAt)}</span>
            </div>
          </Card>

          <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)}>
            我已阅读并知晓：确认不可逆，确认后其余 {Math.max(0, compareRows.length - 1)} 个待确认意向将全部失效
          </Checkbox>
        </Space>
      </Modal>
    </div>
  );
}

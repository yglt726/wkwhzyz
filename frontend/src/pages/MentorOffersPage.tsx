import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, ExclamationCircleOutlined, ThunderboltOutlined, UndoOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { api, errMsg, formatTime, isOverQuotaError } from '../api';

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

export default function MentorOffersPage() {
  const { message } = App.useApp();
  const [roundNo, setRoundNo] = useState(1);
  const [data, setData] = useState<any>(null);
  const [applicants, setApplicants] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [primary, setPrimary] = useState<string[]>([]);
  const [waitlist, setWaitlist] = useState<string[]>([]);
  const [labPicks, setLabPicks] = useState<string[]>([]);
  const [candidateOrder, setCandidateOrder] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = async (rn: number) => {
    setLoading(true);
    try {
      const [o, a, m] = await Promise.all([
        api.get('/mentor/offers', { params: { roundNo: rn } }),
        api.get('/mentor/applicants', { params: { roundNo: rn } }),
        api.get('/meta/bootstrap', { params: { roundNo: rn } }),
      ]);
      setData(o.data);
      setApplicants(a.data);
      setMeta(m.data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(roundNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundNo]);

  const quota = data?.quota;
  const rows = applicants?.rows ?? [];
  const hasMine = rows.some((r: any) => r.appliedToMe);
  const myRows = rows.filter((r: any) => r.appliedToMe);
  const unscored = rows.filter((r: any) => !r.interview || r.interview.status === 'PENDING');
  const interviewWindow = applicants?.interviewWindow;
  const simulatedNow = meta?.stage?.now ? new Date(meta.stage.now) : new Date();
  const interviewOpen = Boolean(
    interviewWindow && simulatedNow >= new Date(interviewWindow.startsAt) && simulatedNow <= new Date(interviewWindow.endsAt),
  );

  const projected = (quota?.confirmed ?? 0) + (quota?.pending ?? 0) + primary.length + labPicks.length;
  const overCount = Math.max(0, projected - (quota?.quota ?? 0));
  const overRatio = quota?.quota ? overCount / quota.quota : 0;

  const labCandidateView: any[] = data?.labAdjustCandidates?.effective ?? [];
  const labViewMap = useMemo(
    () => new Map<string, any>(labCandidateView.map((c: any) => [c.studentId, c])),
    [labCandidateView],
  );
  const offerMap = useMemo(
    () => new Map<string, any>((data?.offers ?? []).map((o: any) => [o.studentId, o])),
    [data],
  );

  const labCandidates = useMemo(() => {
    const rowMap = new Map(rows.map((r: any) => [r.studentId, r]));
    return candidateOrder.map((id, i) => {
      const c: any = labViewMap.get(id) ?? {};
      const r: any = rowMap.get(id) ?? {};
      return {
        studentId: id,
        rank: i + 1,
        name: c.studentName ?? r.name ?? id,
        studentNo: c.studentNo ?? r.studentNo ?? '',
        total: c.total ?? r.interview?.total ?? null,
        scores: c.scores ?? [],
        appliedToMe: Boolean(r),
        picked: false,
      };
    });
  }, [rows, candidateOrder, labViewMap]);

  // 本次将直接录取的室内调剂学生（未进入候选顺位，单独列出）
  const pickedCandidates = useMemo(
    () =>
      labPicks.map((id) => {
        const c: any = labViewMap.get(id) ?? {};
        const o: any = offerMap.get(id) ?? {};
        return {
          studentId: id,
          rank: null,
          name: c.studentName ?? o.studentName ?? id,
          studentNo: c.studentNo ?? o.studentNo ?? '',
          total: c.total ?? null,
          scores: c.scores ?? [],
          appliedToMe: false,
          picked: true,
        };
      }),
    [labPicks, labViewMap, offerMap],
  );

  const candidateRows = useMemo(
    () => [...labCandidates, ...pickedCandidates],
    [labCandidates, pickedCandidates],
  );

  const autoCandidateIds: string[] = useMemo(
    () =>
      (data?.labAdjustCandidates?.auto ?? [])
        .map((c: any) => c.studentId)
        .filter(
          (id: string) =>
            !primary.includes(id) && !waitlist.includes(id) && !labPicks.includes(id),
        ),
    [data, primary, waitlist, labPicks],
  );

  // 室内调剂候选来自本室全部服从调剂的学生，可能包含报同室其他导师的学生
  const addableCandidates = useMemo(() => {
    const rowMap = new Map(rows.map((r: any) => [r.studentId, r]));
    return labCandidateView
      .filter(
        (c: any) =>
          !primary.includes(c.studentId) &&
          !waitlist.includes(c.studentId) &&
          !labPicks.includes(c.studentId) &&
          !candidateOrder.includes(c.studentId),
      )
      .map((c: any) => {
        const r: any = rowMap.get(c.studentId);
        return {
          studentId: c.studentId,
          name: c.studentName ?? r?.name ?? c.studentId,
          studentNo: c.studentNo ?? r?.studentNo ?? '',
          total: c.total ?? r?.interview?.total ?? null,
        };
      });
  }, [rows, primary, waitlist, labPicks, candidateOrder, labCandidateView]);

  const isDefaultOrder = JSON.stringify(candidateOrder) === JSON.stringify(autoCandidateIds);

  const moveCandidate = (index: number, delta: number) => {
    setCandidateOrder((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const changePrimary = (v: string[]) => {
    setPrimary(v);
    setCandidateOrder((prev) => prev.filter((id) => !v.includes(id)));
    setLabPicks((prev) => prev.filter((id) => !v.includes(id)));
  };

  const changeWaitlist = (v: string[]) => {
    setWaitlist(v);
    setCandidateOrder((prev) => prev.filter((id) => !v.includes(id)));
    setLabPicks((prev) => prev.filter((id) => !v.includes(id)));
  };

  const addLabPick = (id: string) => {
    setCandidateOrder((prev) => prev.filter((x) => x !== id));
    setLabPicks((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const removeLabPick = (id: string) => {
    setLabPicks((prev) => prev.filter((x) => x !== id));
    setCandidateOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const openPublish = () => {
    // 重提时回填本轮已提交的名单，避免导师重新选一遍
    const existing: any[] = data?.offers ?? [];
    const prim = existing
      .filter((o) => o.kind === 'PRIMARY' && o.status === 'PENDING')
      .map((o) => o.studentId);
    const wait = existing
      .filter((o) => o.kind === 'WAITLIST' && o.status === 'PENDING')
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((o) => o.studentId);
    const picks = existing
      .filter(
        (o) => o.kind === 'LAB_ADJUST' && o.status === 'PENDING' && o.note === 'MENTOR_LAB_ADJUST',
      )
      .map((o) => o.studentId);
    const eff = (data?.labAdjustCandidates?.effective ?? [])
      .map((c: any) => c.studentId)
      .filter((id: string) => !prim.includes(id) && !wait.includes(id) && !picks.includes(id));
    setPrimary(prim);
    setWaitlist(wait);
    setLabPicks(picks);
    setCandidateOrder(eff);
    setPublishOpen(true);
  };

  const recommend = () => {
    const slots = Math.max(0, (quota?.quota ?? 0) - (quota?.confirmed ?? 0) - (quota?.pending ?? 0));
    const ranked = myRows
      .filter((r: any) => r.interview?.status === 'SCORED')
      .sort((a: any, b: any) => b.interview.total - a.interview.total);
    setPrimary(ranked.slice(0, Math.max(slots, 1)).map((r: any) => r.studentId));
  };

  const doPublish = async (overQuotaConfirm: boolean) => {
    setSubmitting(true);
    try {
      const res = await api.post('/mentor/offers/publish', {
        roundNo,
        primary,
        waitlist,
        labAdjustCandidates: candidateOrder,
        labAdjustPrimary: labPicks,
        overQuotaConfirm,
      });
      const d = res.data;
      const waitingConfirm = Math.max(
        0,
        (d.primary ?? 0) + (d.labAdjustPrimary ?? 0) - (d.autoConfirmed?.length ?? 0),
      );
      message.success(
        `名单已提交：拟录取 ${d.primary} 人，递补 ${d.waitlist} 人${d.labAdjustPrimary ? `，室内调剂录取 ${d.labAdjustPrimary} 人` : ''}${d.autoConfirmed?.length ? `，自动确认 ${d.autoConfirmed.length} 人` : ''}` +
          (waitingConfirm > 0 ? `；请管理员把进度切到「第 ${roundNo} 轮 · 学生确认」，学生端才会出现确认入口` : ''),
      );
      if (d.skippedPlaced?.length) message.warning(`以下学生已有确认去向，已跳过：${d.skippedPlaced.join('、')}`);
      if (d.skippedLabAdjust?.length) message.warning(`以下学生已被其他导师预占，室内调剂录取已跳过：${d.skippedLabAdjust.join('、')}`);
      setPublishOpen(false);
      await load(roundNo);
    } catch (e: any) {
      if (isOverQuotaError(e)) {
        const info = e?.response?.data?.data;
        Modal.confirm({
          title: '拟录取超出名额，确认超发？',
          icon: <ExclamationCircleOutlined />,
          content: (
            <div>
              <p>{e.response.data.message}</p>
              <p style={{ color: '#cf1322' }}>
                超发比例：{info?.overRatio != null ? `${Math.round(info.overRatio * 100)}%` : '-'}
              </p>
              <p style={{ color: '#8c8c8c' }}>超发将计入异常告警并写入审计日志，请确认是否继续。</p>
            </div>
          ),
          okText: '确认超发并提交',
          okButtonProps: { danger: true },
          onOk: () => doPublish(true),
        });
      } else {
        message.error(errMsg(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const tryPublish = () => {
    if (primary.length === 0 && waitlist.length === 0 && labPicks.length === 0) {
      message.warning('请至少选择 1 名学生');
      return;
    }
    const nameOf = (id: string) =>
      rows.find((r: any) => r.studentId === id)?.name ??
      labViewMap.get(id)?.studentName ??
      offerMap.get(id)?.studentName ??
      id;
    Modal.confirm({
      title: overCount > 0 ? '确认提交？本次拟录取将超发' : '确认提交本轮名单？',
      icon: <ExclamationCircleOutlined />,
      width: 560,
      content: (
        <div>
          <p>
            <strong>拟录取（{primary.length}）：</strong>
            {primary.length ? primary.map(nameOf).join('、') : '无'}
          </p>
          <p>
            <strong>递补（{waitlist.length}）：</strong>
            {waitlist.length ? waitlist.map((id, i) => `${i + 1}.${nameOf(id)}`).join('、') : '无'}
          </p>
          <p>
            <strong>室内调剂录取（{labPicks.length}）：</strong>
            {labPicks.length ? labPicks.map(nameOf).join('、') : '无'}
          </p>
          <p>
            <strong>室内调剂候选顺位（{candidateOrder.length}）：</strong>
            {candidateOrder.length ? candidateOrder.map((id, i) => `${i + 1}.${nameOf(id)}`).join('、') : '无'}
          </p>
          {overCount > 0 && (
            <p style={{ color: '#cf1322' }}>
              预计占用 {projected}/{quota?.quota}，超发 {overCount} 人（{(overRatio * 100).toFixed(0)}%）。
            </p>
          )}
          <p style={{ color: '#8c8c8c' }}>
            室内调剂录取会直接占用名额、先到先得；提交后覆盖本轮旧名单。候选顺位仅作为同分时的参考，实际 L1 先按“谁给分最高去谁”定向调剂。
          </p>
        </div>
      ),
      okText: overCount > 0 ? '确认超发并提交' : '确认提交',
      okButtonProps: overCount > 0 ? { danger: true } : undefined,
      onOk: () => doPublish(overCount > 0),
    });
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 2 }}>
            名额与名单
          </Typography.Title>
          <Typography.Text type="secondary">
            名额为软约束：允许超发，后台显示超录比例并告警；放鸽子由管理员登记释放名额。
          </Typography.Text>
        </div>
        <Segmented options={ROUND_OPTIONS} value={roundNo} onChange={(v) => setRoundNo(v as number)} />
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="名额" value={quota?.quota ?? 0} suffix="人" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="已确认 / 名额"
              value={quota?.confirmed ?? 0}
              suffix={`/ ${quota?.quota ?? 0}`}
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

      {quota?.overQuota && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`已超录 ${quota.confirmed - quota.quota} 人，超录比例 ${(quota.overRatio * 100).toFixed(0)}%`}
          description="超录记录已标记 over_quota 并写入审计日志；请与学院确认名额调整，勿继续扩大超录。"
        />
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button type="primary" disabled={!interviewOpen} onClick={openPublish}>
            提交 / 重提拟录取与递补名单
          </Button>
          <Button onClick={() => void load(roundNo)}>刷新</Button>
          {!interviewOpen && <Tag color="orange">当前阶段不可提交</Tag>}
          {unscored.length > 0 && <Tag color="red">你还有 {unscored.length} 人未评分，需先完成评分才能提交</Tag>}
        </Space>
        <div style={{ marginTop: 12 }}>
          <Progress
            percent={Math.min(100, ((quota?.confirmed ?? 0) / Math.max(1, quota?.quota ?? 1)) * 100)}
            status={quota?.overQuota ? 'exception' : 'normal'}
            format={() => `${quota?.confirmed ?? 0}/${quota?.quota ?? 0}`}
          />
          <div className="muted-line">
            账本口径：已确认占用 + 待确认预占 = 当前已用名额；剩余可录 = 名额 - 已确认 - 待确认预占。
          </div>
        </div>
      </Card>

      <Card size="small" title="已提交名单">
        {(data?.offers ?? []).length === 0 ? (
          <Empty description="本轮尚未提交名单" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            loading={loading}
            dataSource={data?.offers ?? []}
            scroll={{ x: 760 }}
            columns={[
              { title: '学生', dataIndex: 'studentName', width: 110 },
              { title: '学号', dataIndex: 'studentNo', width: 110 },
              { title: '类型', dataIndex: 'kindLabel', width: 100 },
              { title: '顺位', dataIndex: 'rank', width: 70, render: (v: any) => v ?? '-' },
              {
                title: '状态',
                dataIndex: 'status',
                width: 110,
                render: (v: string, r: any) => <Tag color={STATUS_COLOR[v]}>{r.statusLabel}</Tag>,
              },
              {
                title: '标记',
                width: 190,
                render: (_: any, r: any) => (
                  <Space size={4} wrap>
                    {r.autoConfirmed && <Tag color="cyan">自动确认</Tag>}
                    {r.overQuota && <Tag color="orange">超发</Tag>}
                    {r.note === 'WAITLIST_PROMOTED' && <Tag color="purple">已递补</Tag>}
                    {r.note === 'MENTOR_LAB_ADJUST' && <Tag color="geekblue">室内调剂录取</Tag>}
                  </Space>
                ),
              },
              { title: '确认/处理时间', dataIndex: 'decidedAt', render: (v: string) => formatTime(v) },
            ]}
          />
        )}
      </Card>

      <Modal
        open={publishOpen}
        title={
          <Space>
            <span>提交名单</span>
            <Tag color="blue">拟录取 / 递补 / 室内调剂</Tag>
          </Space>
        }
        width={860}
        okText={overCount > 0 ? '提交（将触发超发确认）' : '提交名单'}
        cancelText="取消"
        confirmLoading={submitting}
        onCancel={() => setPublishOpen(false)}
        onOk={tryPublish}
        maskClosable={false}
      >
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message="拟录取名单为平行意向，选中顺序不作为志愿先后；递补名单顺序即递补顺位。"
          description="只收到 1 个拟录取的学生会立即自动确认；收到 2 个及以上则在确认窗内自主选择，先确认先锁定。室内调剂录取属于正式拟录取，同样占用名额、先到先得。"
        />

        <div className="publish-quota">
          <Row gutter={12} align="middle">
            <Col xs={12} md={5}>
              <Statistic title="名额" value={quota?.quota ?? 0} />
            </Col>
            <Col xs={12} md={5}>
              <Statistic title="已确认" value={quota?.confirmed ?? 0} />
            </Col>
            <Col xs={12} md={5}>
              <Statistic title="待预占" value={quota?.pending ?? 0} />
            </Col>
            <Col xs={12} md={4}>
              <Statistic title="本次拟录取" value={primary.length + labPicks.length} />
            </Col>
            <Col xs={24} md={5}>
              <Statistic
                title="预计占用 / 超发"
                value={projected}
                suffix={`/ ${quota?.quota ?? 0}`}
                valueStyle={{ color: overCount > 0 ? '#d46b08' : '#389e0d' }}
              />
            </Col>
          </Row>
          <Progress
            percent={Math.min(100, (projected / Math.max(1, quota?.quota ?? 1)) * 100)}
            status={overCount > 0 ? 'exception' : 'normal'}
            format={() => (overCount > 0 ? `超发 ${overCount} 人（${(overRatio * 100).toFixed(0)}%）` : '名额内')}
          />
          {overCount > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`本次提交将超发 ${overCount} 人，超录比例 ${(overRatio * 100).toFixed(0)}%`}
              description="提交后会二次确认；超发记录将写入异常与审计，公示期可追溯。"
            />
          )}
        </div>

        <div className="publish-section-head">
          <span>
            ① 拟录取名单 <Typography.Text type="secondary">只显示报名我的学生，平行意向不分先后</Typography.Text>
          </span>
          <Button size="small" icon={<ThunderboltOutlined />} onClick={recommend} disabled={!hasMine}>
            按面试总分推荐
          </Button>
        </div>
        <Select
          mode="multiple"
          style={{ width: '100%', marginBottom: 14 }}
          placeholder={hasMine ? '选择拟录取学生' : '暂无学生报名我'}
          value={primary}
          onChange={(v) => changePrimary(v)}
          options={myRows.map((r: any) => ({
            value: r.studentId,
            label: `${r.name}（${r.studentNo}）${r.interview?.total != null ? ` · 总分 ${r.interview.total}` : ' · 未评分'}`,
            disabled: waitlist.includes(r.studentId) || labPicks.includes(r.studentId),
          }))}
        />
        {primary.length > 0 && (
          <div className="publish-order">
            拟录取：{primary.map((id, i) => `${i + 1}. ${myRows.find((r: any) => r.studentId === id)?.name ?? id}`).join('　')}
          </div>
        )}

        <Divider style={{ margin: '6px 0 12px' }} />
        <div className="publish-section-head">
          <span>
            ② 递补名单 <Typography.Text type="secondary">选择顺序即递补顺位，可留空</Typography.Text>
          </span>
        </div>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="选择递补学生"
          value={waitlist}
          onChange={(v) => changeWaitlist(v)}
          options={myRows.map((r: any) => ({
            value: r.studentId,
            label: `${r.name}（${r.studentNo}）${r.interview?.total != null ? ` · 总分 ${r.interview.total}` : ''}`,
            disabled: primary.includes(r.studentId) || labPicks.includes(r.studentId),
          }))}
        />
        {waitlist.length > 0 && (
          <div className="publish-order">
            递补顺位：{waitlist.map((id, i) => `${i + 1}. ${myRows.find((r: any) => r.studentId === id)?.name ?? id}`).join('　')}
          </div>
        )}

        <Divider style={{ margin: '16px 0 12px' }} />
        <div className="publish-section-head">
          <span>
            ③ 室内调剂 <Typography.Text type="secondary">直接录取同室未被选择的学生，占用本人名额</Typography.Text>
          </span>
          <Space size={8}>
            <Tag color={isDefaultOrder ? 'default' : 'purple'}>{isDefaultOrder ? '默认顺序' : '已自定义顺序'}</Tag>
            <Button
              size="small"
              icon={<UndoOutlined />}
              disabled={isDefaultOrder}
              onClick={() => setCandidateOrder(autoCandidateIds)}
            >
              恢复默认
            </Button>
          </Space>
        </div>
        <div className="muted-line" style={{ marginBottom: 8 }}>
          列表为本室勾选服从调剂、且尚未被任何导师占用的学生；可查看同室各导师的评分与评语后点击「加入拟录取」直接录取，先到先得。
          未直接录取的学生仅记录为候选顺位，供 L1 调剂在同分时参考。
        </div>
        {candidateRows.length === 0 ? (
          <div className="empty-block small">本室暂无服从室内调剂且未被占用的候选学生</div>
        ) : (
          <Table
            rowKey="studentId"
            size="small"
            pagination={false}
            dataSource={candidateRows}
            scroll={{ x: 760 }}
            expandable={{
              rowExpandable: (r: any) => (r.scores?.length ?? 0) > 0,
              expandedRowRender: (r: any) => (
                <div style={{ padding: '2px 0 2px 8px' }}>
                  {r.scores.map((s: any) => (
                    <div key={s.mentorId} style={{ marginBottom: 4 }}>
                      <Space size={8} wrap>
                        <strong>{s.mentorName || s.mentorId}</strong>
                        <span>总分 {s.total}</span>
                        <span>
                          态度 {s.attitude ?? '-'} / 逻辑 {s.logic ?? '-'} / 编码 {s.coding ?? '-'} / 投入{' '}
                          {s.timeInvest ?? '-'}
                        </span>
                      </Space>
                      <div className="muted-line">评语：{s.remark || '无'}</div>
                    </div>
                  ))}
                </div>
              ),
            }}
            columns={[
              {
                title: '顺位',
                dataIndex: 'rank',
                width: 88,
                render: (v: any, r: any) =>
                  r.picked ? <Tag color="green">直接录取</Tag> : v,
              },
              {
                title: '学生',
                dataIndex: 'name',
                width: 130,
                render: (v: string, r: any) => (
                  <Space size={6}>
                    <span>{v}</span>
                    {r.appliedToMe && <Tag color="blue">报我</Tag>}
                  </Space>
                ),
              },
              { title: '学号', dataIndex: 'studentNo', width: 110 },
              {
                title: '本室面试评分',
                width: 260,
                render: (_: any, r: any) =>
                  r.scores?.length ? (
                    <Space size={[4, 4]} wrap>
                      {r.scores.map((s: any) => (
                        <Tag key={s.mentorId} color={s.total === r.total ? 'green' : undefined}>
                          {s.mentorName || s.mentorId} {s.total}
                        </Tag>
                      ))}
                    </Space>
                  ) : r.total != null ? (
                    <strong>{r.total}</strong>
                  ) : (
                    <Tag>暂无评分</Tag>
                  ),
              },
              {
                title: '操作',
                width: 210,
                render: (_: any, r: any, index: number) =>
                  r.picked ? (
                    <Button size="small" danger onClick={() => removeLabPick(r.studentId)}>
                      移出拟录取
                    </Button>
                  ) : (
                    <Space size={2}>
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        onClick={() => addLabPick(r.studentId)}
                      >
                        加入拟录取
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        icon={<ArrowUpOutlined />}
                        disabled={index === 0}
                        onClick={() => moveCandidate(index, -1)}
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<ArrowDownOutlined />}
                        disabled={index === labCandidates.length - 1}
                        onClick={() => moveCandidate(index, 1)}
                      />
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setCandidateOrder((prev) => prev.filter((id) => id !== r.studentId))}
                      />
                    </Space>
                  ),
              },
            ]}
          />
        )}
        {labPicks.length > 0 && (
          <Alert
            style={{ marginTop: 8 }}
            type="success"
            showIcon
            message={`本次将直接录取 ${labPicks.length} 名室内调剂学生，占用名额 ${labPicks.length} 个；若外部已被其他导师先行预占，提交时会自动跳过并提示。`}
          />
        )}
        {addableCandidates.length > 0 && (
          <Select
            style={{ width: '100%', marginTop: 8 }}
            placeholder="从本室服从室内调剂的学生中追加候选顺位"
            value={null}
            onChange={(id: string) => setCandidateOrder((prev) => [...prev, id])}
            options={addableCandidates.map((r: any) => ({
              value: r.studentId,
              label: `${r.name}（${r.studentNo}）${r.total != null ? ` · 总分 ${r.total}` : ''}`,
            }))}
          />
        )}
      </Modal>
    </div>
  );
}

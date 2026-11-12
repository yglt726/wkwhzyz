import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Empty,
  Progress,
  Row,
  Segmented,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { api, errMsg, formatTime } from '../api';
import { useAuth } from '../auth';

const ROUND_OPTIONS = [
  { label: '第一轮', value: 1 },
  { label: '第二轮补录', value: 2 },
  { label: '第三轮补录', value: 3 },
];

export default function StudentIntentPage() {
  const { user } = useAuth();
  const [roundNo, setRoundNo] = useState(1);
  const [bootstrap, setBootstrap] = useState<any>(null);
  const [myIntents, setMyIntents] = useState<any>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [labAdjust, setLabAdjust] = useState(false);
  const [collegeAdjust, setCollegeAdjust] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async (rn: number) => {
    setLoading(true);
    try {
      const [b, mine] = await Promise.all([
        api.get('/meta/bootstrap', { params: { roundNo: rn } }),
        api.get('/student/intents', { params: { roundNo: rn } }),
      ]);
      setBootstrap(b.data);
      setMyIntents(mine.data);
      if (mine.data?.submitted) {
        setSelected(mine.data.intents.map((i: any) => i.mentorId));
        setLabAdjust(mine.data.application.acceptLabAdjust);
        setCollegeAdjust(mine.data.application.acceptCollegeAdjust);
      } else {
        setSelected([]);
        setLabAdjust(false);
        setCollegeAdjust(false);
      }
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

  const maxIntents = bootstrap?.maxIntents ?? 3;
  const intentWindow = bootstrap?.stage?.windows?.find(
    (w: any) => w.stageKey === 'INTENT' && w.roundNo === roundNo,
  );
  const isOpen = Boolean(intentWindow?.open);
  const labs = bootstrap?.labs ?? [];

  const selectedInfo = useMemo(() => {
    return selected.map((id) => {
      for (const lab of labs) {
        const m = lab.mentors.find((x: any) => x.id === id);
        if (m) return { mentorId: id, labId: lab.id, labName: lab.name, mentorName: m.name };
      }
      return { mentorId: id, labId: '', labName: '', mentorName: id };
    });
  }, [selected, labs]);

  const selectedLabCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of selectedInfo) map[s.labId] = (map[s.labId] ?? 0) + 1;
    return map;
  }, [selectedInfo]);

  const toggleMentor = (id: string) => {
    if (!isOpen) {
      message.info('当前不在意向填报窗口，仅供查看');
      return;
    }
    if (selected.includes(id)) {
      setSelected((prev) => prev.filter((x) => x !== id));
      return;
    }
    if (selected.length >= maxIntents) {
      message.warning(`已选满 ${maxIntents} 个平行意向，请先取消一个再更换`);
      return;
    }
    setSelected((prev) => [...prev, id]);
  };

  const submit = async () => {
    if (selected.length === 0) {
      message.warning('请至少选择 1 个导师意向后再提交');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/student/intents', {
        roundNo,
        mentorIds: selected,
        acceptLabAdjust: labAdjust,
        acceptCollegeAdjust: collegeAdjust,
      });
      message.success('意向已提交，可在窗口内重新填报');
      await load(roundNo);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 2 }}>
            意向填报
          </Typography.Title>
          <Typography.Text type="secondary">
            {user?.name}（{user?.studentNo}）· 本轮最多 {maxIntents} 个导师意向，可同室多导师
          </Typography.Text>
        </div>
        <Segmented options={ROUND_OPTIONS} value={roundNo} onChange={(v) => setRoundNo(v as number)} />
      </div>

      <Alert
        style={{ marginBottom: 16 }}
        type={isOpen ? 'success' : 'warning'}
        showIcon
        message={
          isOpen
            ? `意向填报开放中：${formatTime(intentWindow?.startsAt)} ~ ${formatTime(intentWindow?.endsAt)}`
            : intentWindow
              ? `当前不在填报窗口：${formatTime(intentWindow.startsAt)} ~ ${formatTime(intentWindow.endsAt)}`
              : '该轮尚未配置填报时间窗'
        }
        description={
          isOpen
            ? '三个意向为平行志愿，不分先后；提交后可在窗口内改填。服务端会校验单轮上限、重复导师与窗口时间。'
            : '窗口关闭后本页仅供查阅，提交会被服务端拒绝。'
        }
      />

      <Spin spinning={loading}>
        {!loading && labs.length === 0 && <Empty description="暂无实训室数据" style={{ margin: '48px 0' }} />}

        <Row gutter={[20, 20]}>
          <Col xs={24} lg={16}>
            <Row gutter={[16, 16]}>
              {labs.map((lab: any) => {
                const picked = selectedLabCount[lab.id] ?? 0;
                return (
                  <Col xs={24} key={lab.id}>
                    <Card
                      className={`lab-card ${picked ? 'lab-card-active' : ''}`}
                      title={
                        <Space wrap size={8}>
                          <span>{lab.name}</span>
                          <Tag color="geekblue">该实训室已报 {lab.applicantCount} 位</Tag>
                          <Tag>总名额 {lab.quota}</Tag>
                          {picked > 0 && <Tag color="blue">已选 {picked} 位导师</Tag>}
                        </Space>
                      }
                    >
                      <Typography.Paragraph type="secondary" className="lab-intro">
                        {lab.intro}
                      </Typography.Paragraph>
                      <div className="mentor-list">
                        {lab.mentors.map((m: any) => {
                          const checked = selected.includes(m.id);
                          return (
                            <div
                              key={m.id}
                              role="checkbox"
                              aria-checked={checked}
                              aria-disabled={!isOpen}
                              tabIndex={isOpen ? 0 : -1}
                              className={`mentor-item ${checked ? 'mentor-item-selected' : ''} ${
                                !isOpen ? 'mentor-item-disabled' : ''
                              }`}
                              onClick={() => toggleMentor(m.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleMentor(m.id);
                                }
                              }}
                            >
                              <Checkbox checked={checked} disabled={!isOpen} />
                              <div className="mentor-main">
                                <Space wrap size={6}>
                                  <strong>{m.name}</strong>
                                  <Typography.Text type="secondary">{m.title}</Typography.Text>
                                  <Tag color="cyan">名额 {m.quota}</Tag>
                                  <Tag>剩余可录 {m.remaining}</Tag>
                                  <Tag color="default">{m.applicantCount} 人报名</Tag>
                                </Space>
                                <div className="mentor-intro">{m.intro}</div>
                              </div>
                              {checked && <Tag color="blue">已选</Tag>}
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </Col>

          <Col xs={24} lg={8}>
            <div className="intent-aside">
              <Card size="small" className="intent-summary">
                <Row align="middle" gutter={12}>
                  <Col flex="86px">
                    <Progress
                      type="circle"
                      size={76}
                      percent={Math.round((selected.length / Math.max(1, maxIntents)) * 100)}
                      format={() => `${selected.length}/${maxIntents}`}
                      strokeColor={selected.length === maxIntents ? '#2f5bd7' : undefined}
                    />
                  </Col>
                  <Col flex="auto">
                    <Typography.Text strong>已选 {selected.length} / {maxIntents} 个平行意向</Typography.Text>
                    <div className="muted-line">
                      {selected.length === 0 ? '在左侧勾选导师，可同室多选' : '平行志愿不分先后，可随时取消或更换'}
                    </div>
                  </Col>
                </Row>

                <Divider style={{ margin: '14px 0 10px' }} />

                {selectedInfo.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有选择导师" />
                ) : (
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {selectedInfo.map((s, idx) => (
                      <div className="picked-intent" key={s.mentorId}>
                        <span className="picked-order">{idx + 1}</span>
                        <div className="picked-main">
                          <div className="picked-mentor">{s.mentorName}</div>
                          <div className="muted-line">{s.labName}</div>
                        </div>
                        <Button
                          type="link"
                          size="small"
                          disabled={!isOpen}
                          onClick={() => setSelected((prev) => prev.filter((x) => x !== s.mentorId))}
                        >
                          移除
                        </Button>
                      </div>
                    ))}
                  </Space>
                )}

                <Divider style={{ margin: '14px 0 10px' }} />

                <div className="adjust-block">
                  <div className="adjust-row">
                    <Space>
                      <Switch checked={labAdjust} onChange={setLabAdjust} disabled={!isOpen} size="small" />
                      <span className="adjust-title">服从实训室内部调剂</span>
                    </Space>
                    <div className="adjust-desc">
                      面试合格但未进入本室拟录取时，可能被同室其他导师捞起。勾选只表示接受，不保证录取。
                    </div>
                  </div>
                  <div className="adjust-row">
                    <Space>
                      <Switch checked={collegeAdjust} onChange={setCollegeAdjust} disabled={!isOpen} size="small" />
                      <span className="adjust-title">服从全院实训室调剂</span>
                    </Space>
                    <div className="adjust-desc">
                      本室录满后，可能被调剂到其他有空缺的实训室。勾选只表示接受，不保证有学上。
                    </div>
                  </div>
                </div>

                <Button
                  type="primary"
                  size="large"
                  block
                  style={{ marginTop: 16 }}
                  onClick={submit}
                  loading={submitting}
                  disabled={!isOpen}
                >
                  {myIntents?.submitted ? '提交改填' : '提交意向'}
                </Button>
                {myIntents?.submitted && (
                  <div className="muted-line" style={{ marginTop: 8, textAlign: 'center' }}>
                    最近提交：{formatTime(myIntents.application.updatedAt)}，窗口内可继续改填
                  </div>
                )}
              </Card>

              <Card size="small" className="intent-tip" title={<Space><InfoCircleOutlined /> 填报说明</Space>}>
                <ul className="tip-list">
                  <li>三个意向为平行志愿，不分先后，系统不会按勾选顺序排序。</li>
                  <li>同一实训室可报多位导师；但室内调剂候选池会按学生去重，同一人不会被同室重复捞起。</li>
                  <li>若多个实训室同时拟录取，需在确认阶段自主选择唯一去向。</li>
                  <li>确认即锁定名额，不可撤销；请先想清楚再去确认。</li>
                </ul>
              </Card>
            </div>
          </Col>
        </Row>
      </Spin>
    </div>
  );
}

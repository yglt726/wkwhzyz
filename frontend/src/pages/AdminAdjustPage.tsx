import { Alert, Button, Card, Col, Empty, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, PrinterOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { api, errMsg, formatTime } from '../api';

const LEVEL_LABEL: Record<number, string> = {
  1: 'L1 实训室内部调剂',
  2: 'L2 全院跨实训室调剂',
  3: 'L3 未服从调剂学生最终统筹',
};

const LEVEL_RULES: Record<number, { tag: string; color: string; title: string; rules: string[] }> = {
  1: {
    tag: 'L1',
    color: 'blue',
    title: '实训室内部调剂',
    rules: ['候选：本室有志愿，且勾选「服从室内调剂」仍未被录取', '排序：面试总分从高到低', '去重：同一学生在本室只被捞起一次'],
  },
  2: {
    tag: 'L2',
    color: 'purple',
    title: '全院跨实训室调剂',
    rules: ['候选：L1 后仍未录取，且勾选「服从全院调剂」', '排序：面试总分从高到低，仅投放仍有空余名额的实训室', '去重：已录取学生不再参与'],
  },
  3: {
    tag: 'L3',
    color: 'orange',
    title: '未服从调剂学生最终统筹',
    rules: ['候选：三轮结束后仍未录取的学生', '排序：由管理员在剩余名额内人工统筹，逐条写入审计', '约束：不挤占已确认名额，不重复分配'],
  },
};

function exportCsv(rows: any[]) {
  if (!rows.length) {
    message.warning('当前没有可导出的公示名单');
    return;
  }
  const header = ['序号', '学号', '姓名', '实训室', '导师', '录取类型', '轮次', '超发', '自动确认', '确认时间'];
  const body = rows.map((r: any, i: number) => [
    i + 1,
    r.studentNo ?? '',
    r.studentName ?? '',
    r.labName ?? '',
    r.mentorName ?? '',
    r.kindLabel ?? '',
    r.roundNo ?? '',
    r.overQuota ? '是' : '否',
    r.autoConfirmed ? '是' : '否',
    r.decidedAt ? formatTime(r.decidedAt) : '',
  ]);
  const escape = (v: any) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header, ...body].map((line) => line.map(escape).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `实训室进组公示名单_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminAdjustPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/publicity');
      setData(res.data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (level: number) => {
    setRunning(true);
    try {
      const res = await api.post('/admin/adjust', { level });
      setResult({ ...res.data, level });
      message.success(`${LEVEL_LABEL[level]} 完成：新增录取 ${res.data.assigned} 人`);
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setRunning(false);
    }
  };

  const finalList = data?.finalList ?? [];
  const byLab = data?.byLab ?? [];
  const summary = data?.summary ?? {};
  const publicity = data?.publicity;

  return (
    <div>
      <div className="page-head">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 2 }}>
            调剂与公示
          </Typography.Title>
          <Typography.Text type="secondary">
            三级优先级：室内调剂 → 全院跨室调剂 → 未服从调剂者最终统筹。候选池按学生去重，已录取者不再参与。
          </Typography.Text>
        </div>
        <Space className="no-print" wrap>
          <Button onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => exportCsv(finalList)}>
            导出 CSV
          </Button>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
            打印名单
          </Button>
        </Space>
      </div>

      {publicity && (
        <Alert
          style={{ marginBottom: 16 }}
          type={publicity.open ? 'info' : publicity.phase === 'UPCOMING' ? 'warning' : 'success'}
          showIcon
          message={`结果公示：${formatTime(publicity.startsAt)} ~ ${formatTime(publicity.endsAt)}（${publicity.phase === 'OPEN' ? '公示中' : publicity.phase === 'UPCOMING' ? '未开始' : '已结束'}）`}
          description="公示名单以下表「最终名单」为准；放弃记录单独留档，公示期异议可结合审计日志追溯。"
        />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="总名额" value={summary.totalQuota ?? 0} suffix="人" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="已录取" value={summary.placed ?? 0} suffix="人" valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="未录取" value={summary.unplaced ?? 0} suffix="人" valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="放弃释放" value={summary.released ?? 0} suffix="条" />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="三级调剂优先级与排序依据" style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]}>
          {[1, 2, 3].map((level) => {
            const rule = LEVEL_RULES[level];
            return (
              <Col xs={24} lg={8} key={level}>
                <div className={`adjust-level adjust-level-${level}`}>
                  <Space size={8}>
                    <Tag color={rule.color}>{rule.tag}</Tag>
                    <strong>{rule.title}</strong>
                  </Space>
                  <ul className="tip-list">
                    {rule.rules.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              </Col>
            );
          })}
        </Row>
        <div className="muted-line" style={{ marginTop: 10 }}>
          仅在 ADJUST 时间窗内可执行；建议按 L1 → L2 → L3 顺序并逐级查看结果，重复执行幂等（已录取学生自动跳过）。
        </div>
        <Space className="no-print" wrap style={{ marginTop: 12 }}>
          {[1, 2, 3].map((level) => (
            <Button
              key={level}
              type={level === 1 ? 'primary' : 'default'}
              icon={<SafetyCertificateOutlined />}
              loading={running}
              onClick={() => run(level)}
            >
              {LEVEL_LABEL[level]}
            </Button>
          ))}
        </Space>
      </Card>

      {result && (
        <Card size="small" title={`最近一次执行结果 · ${LEVEL_LABEL[result.level]}`} style={{ marginBottom: 16 }}>
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 12 }}
            message={`新增录取 ${result.assigned} 人 · 剩余名额 ${result.remainingFree} · 执行时间 ${formatTime(result.runAt)}`}
          />
          <Table
            rowKey="offerId"
            size="small"
            pagination={false}
            dataSource={result.assignments ?? []}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该级本次未新增录取" />,
            }}
            columns={[
              { title: '学生', dataIndex: 'studentName', width: 100 },
              { title: '实训室', dataIndex: 'labName' },
              { title: '导师', dataIndex: 'mentorName', width: 100 },
              { title: '优先级', dataIndex: 'level', width: 90, render: (v: number) => <Tag color="purple">L{v}</Tag> },
              { title: '轮次', dataIndex: 'roundNo', width: 70 },
              { title: '排序依据', render: (_: any, r: any) => <span className="muted-line">{r.note ?? '面试总分降序 / 同分按学生去重'}</span> },
            ]}
          />
        </Card>
      )}

      <Card
        size="small"
        title={`公示名单（共 ${finalList.length} 人）`}
        style={{ marginBottom: 16 }}
        extra={
          <Space className="no-print">
            <Button size="small" icon={<DownloadOutlined />} onClick={() => exportCsv(finalList)}>
              导出 CSV
            </Button>
            <Button size="small" icon={<PrinterOutlined />} onClick={() => window.print()}>
              打印
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="offerId"
          size="small"
          loading={loading}
          pagination={{ pageSize: 10, size: 'small' }}
          dataSource={finalList}
          scroll={{ x: 920 }}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已确认录取学生，公示名单为空" />,
          }}
          columns={[
            { title: '序号', width: 60, render: (_: any, __: any, i: number) => i + 1 },
            { title: '学号', dataIndex: 'studentNo', width: 110 },
            { title: '姓名', dataIndex: 'studentName', width: 100 },
            { title: '实训室', dataIndex: 'labName' },
            { title: '导师', dataIndex: 'mentorName', width: 100 },
            { title: '录取类型', dataIndex: 'kindLabel', width: 110 },
            { title: '轮次', dataIndex: 'roundNo', width: 70, render: (v: number) => (v ? `R${v}` : '-') },
            {
              title: '标记',
              width: 140,
              render: (_: any, r: any) => (
                <Space size={4}>
                  {r.autoConfirmed && <Tag color="cyan">自动确认</Tag>}
                  {r.overQuota && <Tag color="orange">超发</Tag>}
                </Space>
              ),
            },
            { title: '确认时间', dataIndex: 'decidedAt', width: 180, render: (v: string) => formatTime(v) },
          ]}
        />
      </Card>

      <Card size="small" title="最终名单（按实训室）" style={{ marginBottom: 16 }}>
        {byLab.length === 0 && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无实训室录取数据" />
        )}
        {byLab.map((lab: any) => (
          <Card
            key={lab.labId}
            type="inner"
            size="small"
            title={`${lab.labName}（名额 ${lab.quota}，已录取 ${lab.members.length}）`}
            style={{ marginBottom: 12 }}
          >
            <Table
              rowKey="offerId"
              size="small"
              pagination={false}
              dataSource={lab.members}
              locale={{
                emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本室暂无录取学生" />,
              }}
              columns={[
                { title: '学生', dataIndex: 'studentName', width: 100 },
                { title: '学号', dataIndex: 'studentNo', width: 110 },
                { title: '导师', dataIndex: 'mentorName', width: 100 },
                { title: '类型', dataIndex: 'kindLabel', width: 100 },
                {
                  title: '标记',
                  width: 140,
                  render: (_: any, r: any) => (
                    <Space size={4}>
                      {r.autoConfirmed && <Tag color="cyan">自动确认</Tag>}
                      {r.overQuota && <Tag color="orange">超发</Tag>}
                    </Space>
                  ),
                },
                { title: '确认时间', dataIndex: 'decidedAt', render: (v: string) => formatTime(v) },
              ]}
            />
          </Card>
        ))}
      </Card>

      <Card size="small" title="放弃/释放记录">
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
    </div>
  );
}

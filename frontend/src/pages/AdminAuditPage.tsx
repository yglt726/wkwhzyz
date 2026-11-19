import { Alert, App, Button, Card, Empty, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';

const TYPE_LABEL: Record<string, string> = {
  OVER_QUOTA: '超录',
  DANGLING_PENDING: '待确认挂起',
  MISSING_CONFIRMATION: '确认记录缺失',
  DOUBLE_BOOKED: '一人双占',
  WITHDRAW_MISMATCH: '释放记录不一致',
};

export default function AdminAuditPage() {
  const { message } = App.useApp();
  const [anomalies, setAnomalies] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('anomaly');

  const load = async () => {
    setLoading(true);
    try {
      const [a, l] = await Promise.all([api.get('/admin/anomalies'), api.get('/admin/audit')]);
      setAnomalies(a.data);
      setLogs(l.data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resolve = async (id: string) => {
    try {
      await api.patch(`/admin/anomalies/${id}/resolve`);
      message.success('异常已标记为处理');
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const pretty = (s: string) => {
    try {
      return JSON.stringify(JSON.parse(s || '{}'), null, 2);
    } catch {
      return s;
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 2 }}>
            异常与审计
          </Typography.Title>
          <Typography.Text type="secondary">
            对账差异不静默：超录、挂起、缺失确认、双占、释放不一致全部留痕；审计日志只追加。
          </Typography.Text>
        </div>
        <Button onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </div>

      {anomalies?.unresolvedCount > 0 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`存在 ${anomalies.unresolvedCount} 条未处理异常`}
          description="请优先核对超录与一人双占；必要时在名额总览登记放弃释放名额后重新对账。"
        />
      )}

      <Card size="small">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'anomaly',
              label: `异常记录（${anomalies?.items?.length ?? 0}）`,
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  dataSource={anomalies?.items ?? []}
                  locale={{
                    emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无异常记录" />,
                  }}
                  columns={[
                    {
                      title: '类型',
                      dataIndex: 'type',
                      width: 150,
                      render: (v: string) => <Tag color={v === 'OVER_QUOTA' || v === 'DOUBLE_BOOKED' ? 'red' : 'orange'}>{TYPE_LABEL[v] ?? v}</Tag>,
                    },
                    { title: '轮次', dataIndex: 'roundNo', width: 70 },
                    { title: '对象', dataIndex: 'entityType', width: 100 },
                    { title: '对象ID', dataIndex: 'entityId', width: 200 },
                    { title: '明细', dataIndex: 'detail', ellipsis: true },
                    {
                      title: '状态',
                      dataIndex: 'resolved',
                      width: 90,
                      render: (v: boolean) => (v ? <Tag color="green">已处理</Tag> : <Tag color="red">未处理</Tag>),
                    },
                    {
                      title: '操作',
                      width: 90,
                      render: (_: any, r: any) =>
                        r.resolved ? null : (
                          <Button type="link" onClick={() => resolve(r.id)}>
                            标记处理
                          </Button>
                        ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'audit',
              label: `审计日志（${logs.length}）`,
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading}
                  pagination={{ pageSize: 12 }}
                  dataSource={logs}
                  locale={{
                    emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审计日志" />,
                  }}
                  expandable={{
                    expandedRowRender: (r: any) => (
                      <pre className="audit-detail">{pretty(r.detail)}</pre>
                    ),
                  }}
                  columns={[
                    { title: '操作人', dataIndex: 'actorName', width: 110 },
                    { title: '角色', dataIndex: 'actorRole', width: 90, render: (v: string) => <Tag>{v}</Tag> },
                    { title: '动作', dataIndex: 'action', width: 190, render: (v: string) => <Tag color="blue">{v}</Tag> },
                    { title: '对象', width: 160, render: (_: any, r: any) => `${r.entityType}${r.entityId ? ` · ${r.entityId}` : ''}` },
                    { title: '明细摘要', dataIndex: 'detail', ellipsis: true },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

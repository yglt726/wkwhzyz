import { Alert, App, Card, Descriptions, Empty, Result, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api, errMsg, formatTime } from '../api';
import { useAuth } from '../auth';

export default function StudentResultPage() {
  const { message } = App.useApp();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/student/result')
      .then((res) => setData(res.data))
      .catch((e) => message.error(errMsg(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 2 }}>
            我的结果
          </Typography.Title>
          <Typography.Text type="secondary">
            {user?.name}（{user?.studentNo}）· 公示期内如有异议，请按学院通知提出申诉。
          </Typography.Text>
        </div>
      </div>

      {data?.publicity && (
        <Alert
          style={{ marginBottom: 16 }}
          type={data.publicity.open ? 'info' : data.publicity.finished ? 'success' : 'warning'}
          showIcon
          message={
            data.publicity.open
              ? `结果公示中：${formatTime(data.publicity.startsAt)} ~ ${formatTime(data.publicity.endsAt)}`
              : data.publicity.finished
                ? '公示期已结束，结果已生效'
                : `公示尚未开始：${formatTime(data.publicity.startsAt)} 开始`
          }
          description={
            data.publicity.open
              ? '公示期内所有确认记录与放弃记录均可追溯（审计日志只追加、不修改）。'
              : undefined
          }
        />
      )}

      <Card loading={loading} className="result-card">
        {data?.placed ? (
          <Result
            status="success"
            title="已正式获得实训室入组资格"
            subTitle={`${data.placement.labName} / ${data.placement.mentorName}（${data.placement.mentorTitle}）`}
            extra={
              <Descriptions column={1} size="small" bordered style={{ textAlign: 'left', minWidth: 420 }}>
                <Descriptions.Item label="录取类型">{data.placement.kindLabel}</Descriptions.Item>
                <Descriptions.Item label="轮次">第 {data.placement.roundNo} 轮</Descriptions.Item>
                <Descriptions.Item label="确认方式">
                  {data.placement.autoConfirmed ? '系统自动确认（仅收到 1 个拟录取）' : '本人确认'}
                </Descriptions.Item>
                <Descriptions.Item label="确认时间">{formatTime(data.placement.decidedAt)}</Descriptions.Item>
              </Descriptions>
            }
          />
        ) : (
          <Empty description="暂未录取。请关注补录/统筹调剂结果，或联系学院管理员。" />
        )}
      </Card>

      <Card size="small" title="全部录取记录" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data?.history ?? []}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无录取记录" />,
          }}
          columns={[
            { title: '轮次', dataIndex: 'roundNo', width: 70 },
            { title: '实训室', dataIndex: 'labName' },
            { title: '导师', dataIndex: 'mentorName' },
            { title: '类型', dataIndex: 'kindLabel' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (v: string, r: any) => (
                <Tag color={v === 'CONFIRMED' ? 'green' : v === 'PENDING' ? 'orange' : 'default'}>
                  {r.statusLabel}
                </Tag>
              ),
            },
            { title: '产生时间', dataIndex: 'createdAt', render: (v: string) => formatTime(v) },
            { title: '处理时间', dataIndex: 'decidedAt', render: (v: string) => formatTime(v) },
            { title: '说明', dataIndex: 'note' },
          ]}
        />
      </Card>
    </div>
  );
}

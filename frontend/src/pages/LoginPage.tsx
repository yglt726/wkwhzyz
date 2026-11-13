import { App, Button, Card, Form, Input, Timeline, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errMsg } from '../api';
import { homeOf, useAuth } from '../auth';

const STEPS = [
  '集中宣讲 · 10/29 14:00',
  '实训室开放日 · 10/29–10/30',
  '意向填报 · 11/2 08:00–12:00',
  '面试考核 · 11/2–11/3',
  '拟录取确认 · 11/4 08:00–12:00',
  '分轮补录 · 11/4–11/5',
  '统筹调剂 · 11/6 08:00–12:00',
  '公示与入组 · 公示 1 天',
];

export default function LoginPage() {
  const { message } = App.useApp();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const doLogin = async (username: string, password: string) => {
    setLoading(true);
    try {
      const user = await login(username, password);
      message.success(`欢迎，${user.name}`);
      navigate(homeOf(user.role), { replace: true });
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-side">
        <div className="login-side-inner">
          <div className="login-eyebrow">2026 秋季 · 学生实训室进组选拔</div>
          <h1>
            选导师，
            <br />
            也选未来的方向。
          </h1>
          <p className="login-desc">
            双向选择 · 3 个平行意向 · 分轮录取 · 室内/全院统筹调剂。
            <br />
            所有环节由服务端时间窗判定，先确认先锁定名额。
          </p>
          <Timeline
            className="login-timeline"
            items={STEPS.map((s, i) => ({
              color: i === 2 || i === 4 ? '#7cd1a8' : 'rgba(255,255,255,.35)',
              children: <span>{s}</span>,
            }))}
          />
        </div>
      </div>
      <div className="login-main">
        <Card className="login-card" variant="borderless">
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            登录选拔系统
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            学生 / 导师 / 学院管理员统一入口，按角色进入对应工作台。
          </Typography.Paragraph>
          <Form form={form} layout="vertical" onFinish={(v) => doLogin(v.username, v.password)}>
            <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input size="large" prefix={<UserOutlined />} placeholder="如 student01 / mentor01 / admin" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password size="large" prefix={<LockOutlined />} placeholder="请输入密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              进入系统
            </Button>
          </Form>
          <Typography.Paragraph type="secondary" className="login-hint">
            演练提示：后台可设置模拟时钟，按 8 个环节推进流程。
          </Typography.Paragraph>
        </Card>
      </div>
    </div>
  );
}

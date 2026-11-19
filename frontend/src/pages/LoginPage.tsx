import { App, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errMsg } from '../api';
import { homeOf, useAuth } from '../auth';
import FluidSmoke from '../components/FluidSmoke';

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
      <FluidSmoke className="login-smoke" />
      <div className="login-main">
        <Card className="login-card" variant="borderless">
          <Typography.Title level={3} className="login-card-title">
            登录选拔系统
          </Typography.Title>
          <Form form={form} layout="vertical" onFinish={(v) => doLogin(v.username, v.password)}>
            <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input size="large" prefix={<UserOutlined />} placeholder="请输入账号" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password size="large" prefix={<LockOutlined />} placeholder="请输入密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              登录
            </Button>
          </Form>
        </Card>
        <div className="login-footer">
          <div className="login-footer-title">软件学院202X年实训室志愿填报系统</div>
          <div className="login-footer-desc">
            双向选择 · 3 个平行意向 · 分轮录取 · 室内/全院统筹调剂
          </div>
        </div>
      </div>
    </div>
  );
}

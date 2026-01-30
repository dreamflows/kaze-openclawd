---
name: lark-mcp
description: 使用飞书/Lark官方 MCP 工具操作飞书平台。支持：文档读取、多维表格操作、任务管理、日程创建、群消息读取、IM消息发送等。当用户需要操作飞书文档、表格、任务、日程或消息时使用此 skill。
metadata: {"moltbot":{"emoji":"📋","requires":{"bins":["npx"]}}}
---

# Lark MCP 飞书操作工具

使用飞书官方 `@larksuiteoapi/lark-mcp` MCP 工具操作飞书平台。

GitHub: https://github.com/larksuite/lark-openapi-mcp

## 前置条件

### 1. 用户授权登录（访问用户数据必须）

如果上下文中有 `UserAccessToken`，可以直接使用。否则需要先登录：

```bash
npx -y @larksuiteoapi/lark-mcp login -a <APP_ID> -s <APP_SECRET> --domain https://open.larksuite.com
```

登录后会保存 token，后续调用会自动使用。

### 2. MCP 工具调用方式

使用 mcporter 调用 lark-mcp 工具：

```bash
# 查看所有可用工具
mcporter list lark-mcp --schema

# 调用工具
mcporter call lark-mcp.<tool_name> param1=value1 param2=value2 --output json
```

---

## 文档操作 (Docx)

### 获取文档内容

```bash
# 获取文档元信息
mcporter call lark-mcp.docx.v1.document.get document_id=<doc_id> --output json

# 获取文档纯文本内容
mcporter call lark-mcp.docx.v1.document.raw_content document_id=<doc_id> --output json

# 获取文档块列表
mcporter call lark-mcp.docx.v1.document_block.list document_id=<doc_id> --output json
```

### 文档 ID 获取方式

从文档 URL 提取：`https://xxx.larksuite.com/docx/ABC123` → document_id = `ABC123`

---

## 多维表格 (Bitable)

### 获取表格信息

```bash
# 获取多维表格元信息
mcporter call lark-mcp.bitable.v1.app.get app_token=<app_token> --output json

# 列出所有数据表
mcporter call lark-mcp.bitable.v1.app_table.list app_token=<app_token> --output json
```

### 读取表格记录

```bash
# 获取记录列表
mcporter call lark-mcp.bitable.v1.app_table_record.list \
  app_token=<app_token> \
  table_id=<table_id> \
  --output json

# 获取单条记录
mcporter call lark-mcp.bitable.v1.app_table_record.get \
  app_token=<app_token> \
  table_id=<table_id> \
  record_id=<record_id> \
  --output json

# 搜索记录（带筛选条件）
mcporter call lark-mcp.bitable.v1.app_table_record.search \
  app_token=<app_token> \
  table_id=<table_id> \
  --args '{"filter":{"conjunction":"and","conditions":[{"field_name":"状态","operator":"is","value":["进行中"]}]}}' \
  --output json
```

### 写入表格记录

```bash
# 创建记录
mcporter call lark-mcp.bitable.v1.app_table_record.create \
  app_token=<app_token> \
  table_id=<table_id> \
  --args '{"fields":{"标题":"新任务","状态":"待处理","负责人":[{"id":"ou_xxx"}]}}' \
  --output json

# 更新记录
mcporter call lark-mcp.bitable.v1.app_table_record.update \
  app_token=<app_token> \
  table_id=<table_id> \
  record_id=<record_id> \
  --args '{"fields":{"状态":"已完成"}}' \
  --output json

# 删除记录
mcporter call lark-mcp.bitable.v1.app_table_record.delete \
  app_token=<app_token> \
  table_id=<table_id> \
  record_id=<record_id> \
  --output json
```

### Bitable Token 获取方式

从 URL 提取：`https://xxx.larksuite.com/base/ABC123` → app_token = `ABC123`

---

## 任务管理 (Task)

### 创建任务

```bash
mcporter call lark-mcp.task.v2.task.create \
  --args '{
    "summary": "任务标题",
    "description": "任务描述",
    "due": {"timestamp": "1735689600"},
    "members": [{"id": "ou_xxx", "role": "assignee"}]
  }' \
  --output json
```

### 查询任务

```bash
# 获取任务详情
mcporter call lark-mcp.task.v2.task.get task_guid=<task_id> --output json

# 列出任务
mcporter call lark-mcp.task.v2.task.list --output json
```

### 更新任务

```bash
mcporter call lark-mcp.task.v2.task.patch \
  task_guid=<task_id> \
  --args '{"task":{"summary":"更新后的标题","completed_at":"1735689600"}}' \
  --output json
```

---

## 日程管理 (Calendar)

### 获取日历列表

```bash
mcporter call lark-mcp.calendar.v4.calendar.list --output json
```

### 创建日程

```bash
mcporter call lark-mcp.calendar.v4.calendar_event.create \
  calendar_id=<calendar_id> \
  --args '{
    "summary": "会议标题",
    "description": "会议描述",
    "start_time": {"timestamp": "1735689600"},
    "end_time": {"timestamp": "1735693200"},
    "attendee_ability": "can_modify_event",
    "attendees": [{"type": "user", "user_id": "ou_xxx"}]
  }' \
  --output json
```

### 查询日程

```bash
# 获取日程详情
mcporter call lark-mcp.calendar.v4.calendar_event.get \
  calendar_id=<calendar_id> \
  event_id=<event_id> \
  --output json

# 列出日程
mcporter call lark-mcp.calendar.v4.calendar_event.list \
  calendar_id=<calendar_id> \
  start_time=<start_timestamp> \
  end_time=<end_timestamp> \
  --output json
```

### 使用预设日历工具

```bash
# 使用默认日历预设（更简单）
mcporter call lark-mcp.preset.calendar.default.<action> ...
```

---

## IM 消息操作

### 发送消息

```bash
# 发送文本消息到群聊
mcporter call lark-mcp.im.v1.message.create \
  receive_id_type=chat_id \
  --args '{
    "receive_id": "<chat_id>",
    "msg_type": "text",
    "content": "{\"text\":\"Hello from MCP!\"}"
  }' \
  --output json

# 发送富文本消息
mcporter call lark-mcp.im.v1.message.create \
  receive_id_type=chat_id \
  --args '{
    "receive_id": "<chat_id>",
    "msg_type": "post",
    "content": "{\"zh_cn\":{\"title\":\"标题\",\"content\":[[{\"tag\":\"text\",\"text\":\"内容\"}]]}}"
  }' \
  --output json
```

### 读取群消息

```bash
# 获取群聊消息列表
mcporter call lark-mcp.im.v1.message.list \
  container_id_type=chat \
  container_id=<chat_id> \
  --output json

# 获取单条消息
mcporter call lark-mcp.im.v1.message.get message_id=<message_id> --output json
```

### 群聊管理

```bash
# 获取群聊列表
mcporter call lark-mcp.im.v1.chat.list --output json

# 获取群聊信息
mcporter call lark-mcp.im.v1.chat.get chat_id=<chat_id> --output json

# 获取群成员
mcporter call lark-mcp.im.v1.chat_members.get chat_id=<chat_id> --output json
```

---

## 知识库 (Wiki)

### 获取知识库信息

```bash
# 列出知识空间
mcporter call lark-mcp.wiki.v2.space.list --output json

# 获取知识空间节点
mcporter call lark-mcp.wiki.v2.space_node.list space_id=<space_id> --output json

# 获取节点信息
mcporter call lark-mcp.wiki.v2.space_node.get token=<node_token> --output json
```

---

## 用户与通讯录

### 获取用户信息

```bash
# 通过 open_id 获取用户
mcporter call lark-mcp.contact.v3.user.get \
  user_id=<open_id> \
  user_id_type=open_id \
  --output json

# 搜索用户
mcporter call lark-mcp.contact.v3.user.batch_get_id \
  --args '{"emails":["user@example.com"]}' \
  --output json
```

---

## 常用预设工具

lark-mcp 提供了一些预设工具集，使用更简单：

```bash
# 日历预设
preset.calendar.default

# IM 预设
preset.im.default

# 文档预设
preset.docx.default
```

启用预设工具需要在 MCP 配置中指定，例如：
`-t preset.calendar.default,preset.im.default`

---

## 注意事项

1. **权限要求**：确保飞书应用已申请对应 API 的权限
2. **用户授权**：访问用户私有数据（文档、日程等）需要 user_access_token
3. **ID 类型**：user_id 有多种类型（open_id, union_id, user_id），注意指定 `user_id_type`
4. **时间戳**：时间参数使用 Unix 时间戳（秒）
5. **JSON 参数**：复杂参数使用 `--args '{...}'` 传递 JSON

## 错误排查

- **99991663**: 权限不足，检查应用权限配置
- **99991668**: token 过期，重新登录授权
- **99991400**: 参数错误，检查参数格式

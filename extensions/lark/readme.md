clawdbot config set channels.lark.enabled true
clawdbot config set channels.lark.appId "cli_a9fc5173f1b8ded0"
clawdbot config set channels.lark.appSecret "zg3K9mVcKMcGdDBZTrf9Ybr3lKa2YFN6"

# Lark bot openID: Mentioned Only Response
clawdbot config set channels.lark.botOpenId "ou_60fbc6f87749c6b6f7816136d1d816b6"


## Cloudflare构建Lark Webhook链接：
cloudflared tunnel login
cloudflared tunnel create lark-webhook

# 每次都会变，临时方案：
cloudflared tunnel --url http://localhost:9000


# Oauth Lark：
https://warming-evanescence-tone-unions.trycloudflare.com/oauth/callback

clawdbot config set channels.lark.oauthRedirectUri "https://warming-evanescence-tone-unions.trycloudflare.com/oauth/callback"

# Oauth权限：
clawdbot config set channels.lark.oauthScope "docx:document wiki:wiki:readonly drive:drive:readonly bitable:app"

# Skills：
clawdbot config set 'skills.load.extraDirs' '["~/.clawdbot/skills"]'



# Architecture:
Deploy: Tencent Cloud (Kaze大管家)

Clawdbot:
    1. Skills:
        mcporter -> Lark-MCP
        Larkmcp Skills;


Webhook: Lark开发者平台（Bot App），回调 -> 

    接受信息：群里面有人at Bot ->  (回调) https://warming-evanescence-tone-unions.trycloudflare.com/webhook (CloudFlare Tunnel) 
                            ->  转发到 Tencent Cloud 43.162.107.61 （本机）9000端口  -> Lark Extension  -> Clawdbot Channel
                            -> Agent 操作 
    Agent操作：
        通过Lark-MCP：(https://github.com/larksuite/lark-openapi-mcp)
            1. 读写群消息；
            2. 读写文档；多维表格；
            ..... 

    发送信息：
        Lark-MCP -> 发送信息：发到群里面；


改动点：
1. Fork了一份 -> 增加了extension下的lark
    /home/ubuntu/kaze_moltbot/moltbot/extensions/lark

    运行的是预装Clawdbot：
        读指定路径下的extension：

2. 增加了lark-mcp skill：(SLILL.md)
    /home/ubuntu/.clawdbot/skills/lark-mcp/SKILL.md


完全重新配置：
1. 先Tencent Cloud开一台预装了Clawdbot金属机
2. 增加我的这些改动点；
    extension: lark
    skill: lark-mcp
3. 在lark开发者平台上，创建新的Bot App，拿到App ID，App secret，权限配置好；
4. 运行clawdbot：
    让他去支持：Lark-MCP：(https://github.com/larksuite/lark-openapi-mcp)


# 角色通关与奖励登记

会后给 AI 一份定稿会单、实际角色调整和获奖名单，它可以整理当期登记材料，列出仍需核对的人和事项。Super AI Lab 有登记权限的经办人可以继续把材料写入正式成长记录。

## 安装

在支持 Skills 的助手里复制下面这句话。公开版标识末尾的 `-public` 可以让它与官员内部版并存。

> 请从 https://github.com/FelixMaofei/mingyuan-role-pass-tracker 安装 Skill 到名为 `mingyuan-role-pass-tracker-public` 的 Skills 子目录。若此目录已安装同一公开版，更新它。

也可以手动安装。将仓库复制到你的助手识别的 Skills 目录，保留 `SKILL.md`、`scripts` 和 `examples` 的相对位置。

```sh
git clone https://github.com/FelixMaofei/mingyuan-role-pass-tracker.git mingyuan-role-pass-tracker-public
cd mingyuan-role-pass-tracker-public
```

## 先跑一场虚构例会

安装 Node.js 20 或以上版本，在 Skill 目录执行下面的命令。演练只在内存里计算，每次从零开始。

```sh
node scripts/rehearse.mjs
```

示例甲参加了两期例会，拿到一次最佳主持。月底确认这两场就是完整清单后，甲获得 5 元最佳奖励、5 元全勤奖励，已用 2 元，剩余 8 元。示例乙出席一次，未获奖，余额为 0 元。可以复制 [演练材料](examples/rehearsal.json)，调整角色、出勤和获奖情况，再试一次。

```sh
node scripts/rehearse.mjs /path/to/my-rehearsal.json
```

## 把本期会单整理成登记材料

> 请用 `mingyuan-role-pass-tracker-public`，根据我接下来给的会后定稿会单、角色变更和获奖名单，生成一份本期登记 JSON，分别告诉我出席、角色和最佳是否登记齐全。

该 JSON 对应演练材料中 `meetings` 数组里**一场会议**的对象。正式资料保存在俱乐部自己的工作目录。还没收到最佳名单时，填为待补；明确本期无人获奖时，可以填为已齐。

## 有权限的经办人

在俱乐部已经配置好登记权限、内部程序及其依赖的终端上，令 `CLUB_GROWTH_CLI` 指向内部 `growth-ledger.mjs` 的绝对路径。如果内部程序使用特定 Node 运行环境，再将 `CLUB_GROWTH_NODE` 指向那套环境的 Node 可执行文件。两个设置均由经办人或管理员在自己的设备上完成。公开安装包不配置俱乐部访问权限。

```sh
node scripts/club.mjs summary
node scripts/club.mjs update /path/to/meeting.json --dry-run
node scripts/club.mjs update /path/to/meeting.json
node scripts/club.mjs rewards 会员显示名
```

预览返回的是本次拟登记的变化。正式命令成功后，依据回执报告当期人数、获奖情况和仍待补齐的材料。普通会员也可以把登记 JSON 交给经办人代录。

[角色、奖项与更正规则](SKILL.md) · [虚构演练材料](examples/rehearsal.json)

开发者可运行 `node --test tests/*.test.mjs` 验证登记、全勤认定、跨轮通关、奖项结算及命令转交。

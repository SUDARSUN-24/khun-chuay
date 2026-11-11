# Putting Khun Chuay on LINE (about 10 minutes, free)

You need: a LINE account (on your phone) and an email address for Cloudflare.
Everything is on the free plans. No credit card needed.

## 0. Try it first (optional, 1 minute)
```
cd C:\Projects\khun-chuay
npm run try
```
Type `ตั้งพร้อมเพย์ 08xxxxxxxx`, then `หาร 1850 4`, then open the QR image it saved and scan it with your bank app. **Don't press pay**, just check that it shows your name and the amount. Type `/quit` to leave.

## 1. Create the LINE bot (5 min)
1. Go to **https://developers.line.biz/console/** and log in with LINE.
2. **Create a provider.** The name can be anything, e.g. your name.
3. Inside it, **Create a new channel ➜ Messaging API**.
   - Channel name: `Khun Chuay` (or any name you like; this is what friends see)
   - Category: *Lifestyle* or similar · Region: Thailand · fill in the rest
4. Open the channel and copy two keys into Notepad for a minute:
   - **Basic settings** tab ➜ **Channel secret**
   - **Messaging API** tab ➜ scroll down ➜ **Channel access token** ➜ *Issue* ➜ copy

⚠️ Never post these two keys in a chat, a screenshot or GitHub.

## 2. Deploy to Cloudflare (3 min)
Make a free account at **https://dash.cloudflare.com/sign-up** (just email), then:
```
cd C:\Projects\khun-chuay
npm run setup
```
It will:
1. open your browser to log in to Cloudflare (click **Allow**)
2. create the free storage
3. deploy the bot. If it asks you to pick a `workers.dev` subdomain, type any name.
4. ask you to paste the **Channel secret** and the **access token** from step 1
5. print your **Webhook URL**, ending in `/webhook`

## 3. Connect LINE to the bot (2 min)
In **LINE Developers ➜ your channel ➜ Messaging API** tab:
- **Webhook URL:** paste the URL from step 2 ➜ **Update** ➜ **Verify** ➜ should say *Success*
- **Use webhook:** ON
- **Allow bot to join group chats:** Edit ➜ ON

Click the **LINE Official Account Manager** link on the same page ➜ **Settings ➜ Response settings**:
- **Auto-response:** OFF   ·   **Greeting message:** OFF   ·   **Webhooks:** ON

## 4. Use it 🎉
- Scan the bot's **QR code** (Messaging API tab) with LINE to add it as a friend, and say `สวัสดี`.
- Type `ตั้งพร้อมเพย์ 08xxxxxxxx`.
- Send your **location** (+ ➜ Location) to get air + rain, then `แจ้งเตือน 7` for a daily summary.
- Invite it into your friends' group and type `หาร 1850 4` after dinner.

## If something doesn't work
- **No reply at all:** check that *Use webhook* is ON, *Auto-response* is OFF, and *Verify* says Success.
- **"Verify" fails:** the URL must end with `/webhook`. Run `npx wrangler deploy` again.
- **See what the bot is doing:** `npx wrangler tail` shows live logs while you message it.
- **Changed the code?** `npm test`, then `npx wrangler deploy`.

"""Optional PDF rebuild: pip install reportlab pillow; set COURT_CJK_FONT if needed."""
from pathlib import Path
import os
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.colors import HexColor
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
font = os.environ.get('COURT_CJK_FONT', 'C:/Windows/Fonts/msyh.ttc')
pdfmetrics.registerFont(TTFont('CJK', font, subfontIndex=0))
W, H = 595.276, 841.89
pdf = canvas.Canvas(str(ROOT / 'docs/Court-Guide.pdf'), pagesize=(W,H))
pdf.setTitle('羽约 1.1.0 - Chrome / Edge 合并使用指南')
pdf.setAuthor('羽约')
style = ParagraphStyle('body',fontName='CJK',fontSize=11,leading=19,textColor=HexColor('#29352f'),wordWrap='CJK')

def paragraph(text,y,size=11,color='#29352f'):
    st = ParagraphStyle('p', parent=style, fontSize=size, leading=size*1.7, textColor=HexColor(color))
    p=Paragraph(text,st); _,h=p.wrap(W-88,H)
    assert y+h<785, (text,y,h)
    p.drawOn(pdf,44,H-y-h)
    return y+h+15

def page(n,title):
    if n>1: pdf.showPage()
    pdf.setFillColor(HexColor('#61326b'));pdf.rect(0,H-7,W,7,fill=1,stroke=0)
    paragraph('羽约 1.1.0 / Chrome 与 Edge 通用',25,9,'#68746e')
    paragraph(title,67,23,'#61326b')
    pdf.setFont('CJK',9);pdf.setFillColor(HexColor('#68746e'))
    pdf.drawString(44,29,'2026-11-26 · 本地导入版 · 以学校订单结果为准')
    pdf.drawRightString(W-44,29,f'{n} / 5')
    return 130

def shot(name,y):
    file=ROOT/'docs/images'/name
    with Image.open(file) as im: h=(W-88)*im.height/im.width
    assert y+h<770
    pdf.drawImage(str(file),44,H-y-h,width=W-88,height=h)
    return y+h+18

y=page(1,'从解压开始：Chrome 安装')
y=paragraph('下载 Court-1.1.0.zip，解压到固定位置。Chrome 和 Edge 使用同一份发布包；从 GitHub 下载源码也可以安装。',y)
y=paragraph('① 地址栏输入 chrome://extensions<br/>② 开启「开发者模式」<br/>③ 点击「加载已解压的扩展程序」<br/>④ 选择解压后含 manifest.json 的 extension 文件夹。',y)
y=shot('chrome-extensions.png',y)
y=paragraph('截图为安装入口示例，浏览器版本变化可能影响按钮位置。不要选择 ZIP 或 extension 的上一级目录。导入后在浏览器扩展菜单固定「羽约」。',y,10)

y=page(2,'同一个发布包：Edge 安装')
y=paragraph('① 地址栏输入 edge://extensions<br/>② 开启「开发人员模式」或「开发者模式」<br/>③ 点击「加载解压缩的扩展」<br/>④ 选择与 Chrome 相同的 extension 文件夹。',y)
y=shot('edge-extensions.png',y)
y=paragraph('不要在两个浏览器同时为同一账号预约。插件的防重复提交锁只在当前扩展存储内生效，不能协调不同浏览器或浏览器配置。',y)
y=paragraph('更新：先处理正在执行或待查任务，再替换文件、重新加载扩展并刷新学校页面。已进入提交阶段的旧任务必须先核对学校订单。',y,10)

y=page(3,'21:58 安排，22:00 执行')
for text in [
 '1. 自行登录 https://booking.cuhk.edu.cn/index，依次进入「运动场地 → 羽毛球场 → 预订」，停在含日期、场地和时间列的日历页。',
 '2. 打开羽约，填写打球日期、开始时间、联系电话、主题、参与人数、用途说明。一次只预约一个整点小时、一个场地。',
 '3. 检查放号时间：插件按打球日期前两天北京时间 22:00 计算。例如今晚放后天的场地，就选择后天的打球日期。若已过放号时间，点击后立即执行。',
 '4. 默认勾选「只填表，停在提交前」。正式预约要取消勾选，再点击「确认自动提交一个场地」。这会占用账号的学校预约配额。',
 '5. 确认「已安排，等待放号」及准备完成日志。关闭弹窗后任务继续；保持日历标签页可见、电脑唤醒、网络正常，不要手动切换日期或账号。',
 '优先级：6 → 4/5/7 → 11/12/13/14 → 3/8 → 9/10 → 1/2。插件不会绕过配额或预约权限，也不保证抢到。',
 '定时依赖本机时间。请保持系统时间正确，学校服务器实际开放可能延迟。'
]:y=paragraph(text,y)

y=page(4,'先演练：只填表，不提交')
for text in [
 '选择学校已开放、尚未开始的日期和时段，填写预约资料，然后点击「10 秒倒计时演练 · 只填表」。这个按钮由后台强制为测试模式。',
 '10 秒后运行同样的刷新、选场、打开表单、填写、回读校验流程。结束状态为「已填表 · 未提交」，不会获得提交许可或点击学校的提交按钮。',
 '检查学校表单后手动关闭。没有可用场地时会重试并最终结束；演练不会提前开放学校容量。',
 '普通「开始填表测试」按正常放号时刻运行；只有独立的 10 秒演练按钮会安排短倒计时。',
 '耗时记录：触发延迟、刷新、网络周期、打开表单、表单响应、填写校验、执行到填好、到点至填好、尝试轮数、换场次数。它们反映当次运行，不能当作高峰性能保证。',
 '页面检查 → 导出页面结构：用于排查学校网页变化。只导出结构、位置及白名单标签，不读取输入值、Cookie 或密码；分享前仍请检查文件。'
]:y=paragraph(text,y)

y=page(5,'重试、订单与隐私')
for text in [
 '放号延迟、刷新失败、表单打开超时：在有限窗口内重试，尊重服务端 Retry-After。登录失效、配额不足或权限错误停止。',
 '提交后明确提示当前场地被其他人预订：只有来自本次提交的新提示且上下文匹配，才排除该场地、换下一个。',
 '普通失败、超时、断网、结果不明：保留提交标记，只查订单，不盲目重复提交。重复唤醒或后台重启也不能直接再点击一次。',
 '「预约已核实」：仍应检查学校我的预订。订单生成且待审核不等于审核通过。「结果待人工核验」：先去学校查清订单，再结束待查任务。停止插件无法撤回学校订单。',
 '数据：联系方式、活动资料和最近任务保存在当前浏览器本地。无外部统计或上传服务、不保存登录密码。正式预约将资料填写到学校。',
 '反馈请提供版本、浏览器、出错阶段、脱敏提示和耗时。不要公开密码、Cookie、真实联系方式、订单信息或浏览器配置。',
 '本版已通过本地模拟回归测试；这些测试不提交真实订单，也不代表十点高峰的实际成功率。更多说明见仓库 README 与合并图文教程。'
]:y=paragraph(text,y,10.5)
pdf.save()
print('docs/Court-Guide.pdf')

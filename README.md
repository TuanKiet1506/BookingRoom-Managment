# Website Đặt Lịch Phòng Họp

Bản web tĩnh lấy phong cách giao diện từ dự án `QuanLySanCauLong`: sidebar tối,
topbar, lịch theo khung giờ và modal đặt lịch.

## Chạy thử

Web dùng nút `Đăng nhập với Google` và chỉ cho phép tài khoản
`admin@khomes.com.vn` truy cập.

Khi chạy trên Vercel, cấu hình các biến môi trường:

- `GOOGLE_CLIENT_ID`: OAuth 2.0 Web Client ID của Google.
- `SESSION_SECRET`: chuỗi bí mật dùng để ký phiên đăng nhập.
- `GOOGLE_APPS_SCRIPT_URL`: Web App URL `/exec` của Apps Script.
- `TELEGRAM_BOT_TOKEN`: token bot Telegram lấy từ BotFather.
- `TELEGRAM_CHAT_ID`: ID group Telegram nhận thông báo.
- `CRON_SECRET`: chuỗi bí mật dùng để test cron thủ công.

Trong Google Cloud Console, thêm domain Vercel vào `Authorized JavaScript origins`.
Khi chạy local, thêm origin local tương ứng, ví dụ `http://localhost:3000`.

Nếu chưa cấu hình Google Sheet, web sẽ lưu tạm bằng `localStorage`.

## Nhắc lịch Telegram

Endpoint nhắc lịch trước 1 giờ:

`/api/cron/reminders?secret=CRON_SECRET`

Vercel Hobby chỉ cho Cron Job chạy 1 lần/ngày, nên không phù hợp để nhắc lịch
trước 1 giờ. Hãy dùng một dịch vụ cron ngoài như cron-job.org/UptimeRobot gọi
endpoint trên mỗi 5 phút, hoặc nâng Vercel Pro rồi thêm cron `*/5 * * * *` vào
`vercel.json`.

Endpoint gửi ảnh lịch 7 ngày tới:

`/api/cron/weekly-snapshot?secret=CRON_SECRET`

File `vercel.json` đang cấu hình endpoint này chạy lúc 23:00 UTC mỗi ngày,
tương ứng 06:00 sáng theo giờ Việt Nam.

## Lệnh Telegram Bot

Webhook nhận lệnh:

`/api/telegram/webhook`

Sau khi deploy, cấu hình webhook cho Telegram:

`https://api.telegram.org/botTELEGRAM_BOT_TOKEN/setWebhook?url=https://booking-room-managment.vercel.app/api/telegram/webhook`

Các lệnh đang hỗ trợ:

- `/help`
- `/today`
- `/tomorrow`
- `/upcoming`
- `/book`
- `/cancel`
- `/confirm`
- `/abort`

## Lưu Google Sheet

1. Mở Google Sheet lưu dữ liệu:
   `https://docs.google.com/spreadsheets/d/1VK4fZ0ajQk8Bj5Cl0DaQdjXsBA5NJGp-lo6P83dSQ6U/edit#gid=1618723751`
2. Mở `Extensions > Apps Script`.
3. Dán toàn bộ nội dung file `google-apps-script.gs` vào Apps Script.
4. Chạy hàm `setupMeetingSheet` một lần để tạo sheet `Bookings`, các cột và trigger dọn dữ liệu hằng năm.
5. Deploy Apps Script dạng `Web app`.
6. Chọn `Execute as: Me` và `Who has access: Anyone with the link`.
7. Copy Web App URL vào biến môi trường `GOOGLE_APPS_SCRIPT_URL` trên Vercel.

Khi deploy trên Vercel, web sẽ gọi Google Sheet thông qua endpoint
`/api/sheets` để tránh lỗi CORS. Khi mở trực tiếp `index.html`, web sẽ thử gọi
thẳng Apps Script.

Lưu ý: không cần dán link Google Sheet vào web. File `google-apps-script.gs`
đang khóa dữ liệu vào Spreadsheet ID
`1VK4fZ0ajQk8Bj5Cl0DaQdjXsBA5NJGp-lo6P83dSQ6U`, nên Web App URL sẽ ghi vào
đúng Google Sheet này sau khi deploy lại.

Cột dữ liệu được tạo:

`id`, `date`, `startTime`, `endTime`, `room`, `topic`, `ownerEmail`, `note`,
`status`, `createdAt`, `cancelledAt`, `cancelledBy`, `telegramStatus`.

## Nghiệp vụ đã có

- Đăng nhập bằng Google và chỉ cho phép `admin@khomes.com.vn`.
- Đặt lịch theo ngày, giờ bắt đầu, giờ kết thúc và chủ đề cho một phòng họp duy nhất.
- Chặn lịch bị trùng khung giờ ở frontend và Apps Script.
- Mọi tài khoản nhân viên đều có thể hủy lịch bất kỳ.
- Ghi nhật ký nội dung thông báo đặt/hủy lịch để kết nối Telegram sau.
- Gửi Telegram khi đặt lịch, hủy lịch và nhắc trước giờ họp khoảng 1 giờ.
- Đồng bộ Google Sheet nếu có Web App URL, fallback localStorage nếu chưa có.
- Tự động xóa toàn bộ dòng dữ liệu trong tab `Bookings` vào ngày 01/01 hằng năm,
  giữ lại dòng tiêu đề cột.
- Apps Script chuẩn hóa ngày về `YYYY-MM-DD` và giờ về `HH:mm` để lịch vừa lưu
  xong hiển thị lại đúng trên giao diện.
- Có nút xuất file CSV mở được bằng Excel cho lịch đang hiển thị.
- Đặt lịch lặp lại hàng tuần (recurring) tự sinh các buổi cho nhiều tuần tới,
  tự gia hạn qua trigger hằng ngày (xem mục "Lịch lặp lại hàng tuần").

## Lịch lặp lại hàng tuần (recurring)

Ngoài đặt lịch đơn lẻ, hệ thống hỗ trợ lịch lặp lại mỗi tuần vào một thứ cố
định (ví dụ 11:00 thứ Hai hàng tuần). Cách hoạt động:

- Mỗi lịch lặp được lưu thành một *template* trong tab `RecurringTemplates`.
- Apps Script tự sinh các buổi cụ thể cho `RECURRING_WEEKS_AHEAD` tuần tới
  (mặc định 8 tuần) vào tab `Bookings`. Vì là booking bình thường nên vẫn được
  chống trùng giờ, nhắc Telegram trước 1 giờ và hủy như lịch thường.
- Trigger chạy hằng ngày sẽ "gia hạn" cửa sổ này, nên luôn có sẵn ~8 tuần phía
  trước mà không bao giờ cạn.
- Mỗi buổi có `id` ổn định `rec-<templateId>-<ngày>` nên chạy lại không tạo
  trùng; nếu người dùng hủy một buổi thì buổi đó không bị sinh lại.

Tạo lịch lặp trên web: mở **Đặt lịch mới**, tick **"Lặp lại hàng tuần"** rồi xác
nhận (thứ trong tuần lấy theo ngày đang chọn).

Tạo sẵn 4 lịch cố định qua Apps Script (chạy một lần trong trình soạn thảo):

```
seedDefaultRecurringTemplates()
```

Hàm này thêm và sinh lịch cho:

| Thứ | Giờ | Chủ đề |
| --- | --- | --- |
| Thứ Hai | 11:00–12:00 | Team Project B2B |
| Thứ Ba | 10:00–11:00 | Team Finance |
| Thứ Ba | 11:00–12:00 | Team KOL |
| Thứ Ba | 14:00–15:00 | Team Khoá Bosch |

Sau khi cập nhật file `google-apps-script.gs`, dán lại toàn bộ vào Apps Script,
chạy `setupMeetingSheet` một lần (tạo tab `RecurringTemplates` + trigger hằng
ngày), rồi deploy lại Web App. Trigger cũ tên `annualCleanupBookings` vẫn dùng
được vì hàm này giờ đảm nhận cả dọn dữ liệu đầu năm lẫn gia hạn lịch lặp.

## Deploy Vercel

Đẩy thư mục này lên GitHub, sau đó import repo vào Vercel. Vercel sẽ phục vụ
`index.html` như một static site.

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

Trong Google Cloud Console, thêm domain Vercel vào `Authorized JavaScript origins`.
Khi chạy local, thêm origin local tương ứng, ví dụ `http://localhost:3000`.

Nếu chưa cấu hình Google Sheet, web sẽ lưu tạm bằng `localStorage`.

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
- Đồng bộ Google Sheet nếu có Web App URL, fallback localStorage nếu chưa có.
- Tự động xóa toàn bộ dòng dữ liệu trong tab `Bookings` vào ngày 01/01 hằng năm,
  giữ lại dòng tiêu đề cột.
- Apps Script chuẩn hóa ngày về `YYYY-MM-DD` và giờ về `HH:mm` để lịch vừa lưu
  xong hiển thị lại đúng trên giao diện.
- Có nút xuất file CSV mở được bằng Excel cho lịch đang hiển thị.

## Deploy Vercel

Đẩy thư mục này lên GitHub, sau đó import repo vào Vercel. Vercel sẽ phục vụ
`index.html` như một static site.

# TilePier

Một bảng điều khiển gồm các công cụ nhỏ do bạn tự sắp xếp: đồng hồ, lịch âm,
thời tiết, tỷ giá, thị trường, ghi chú, nhạc và video của chính bạn. Những gì
bạn đưa vào đều ở lại trên thiết bị của bạn. Song ngữ (Tiếng Việt và English),
không tài khoản, không quảng cáo, không cookie theo dõi.

**[tilepier.win](https://tilepier.win)** · [English](README.md)

## TilePier là gì

- **Dữ liệu ở máy bạn trước tiên.** Bảng tile, ghi chú và danh sách, cài đặt
  và thư viện nhạc nằm trong trình duyệt của bạn (localStorage và IndexedDB).
  Phần Cài đặt có bản sao lưu để xuất ra và khôi phục; không có gì được tải
  lên.
- **Chạy cả khi offline.** Có thể cài như một ứng dụng, và những gì bạn đã
  dùng vẫn chạy khi mất mạng. Tile cần mạng sẽ cho biết dữ liệu của nó đã cũ
  bao lâu, thay vì để trống.
- **Một máy chủ nhỏ.** Thời tiết, tỷ giá, thị trường, nguồn tin và tìm địa
  điểm đi qua một Cloudflare Worker giữ các khoá API, lưu đệm câu trả lời và
  chỉ chuyển đi phần tile cần. Trình duyệt của bạn không nói chuyện với nơi
  nào khác, ngoài những gì ghi ở phần quyền riêng tư bên dưới.

## Các widget

| Widget           | Làm gì                                                       |
| ---------------- | ------------------------------------------------------------ |
| Đồng hồ          | Giờ địa phương, ngày, và các múi giờ bạn theo dõi            |
| Hẹn giờ          | Đếm ngược và pomodoro, kèm nhật ký tập trung                 |
| Máy tính         | Bốn phép tính, số thập phân chính xác, và đổi đơn vị         |
| Ghi chú          | Ghi chú Markdown, lưu trên thiết bị này                      |
| Việc cần làm     | Danh sách và hạn chót, lưu trên thiết bị này                 |
| Lịch             | Lịch tháng, có lịch âm Việt Nam                              |
| Hộp công cụ      | Mã QR, mật khẩu và màu sắc, gói trong một tile               |
| Tiền tệ          | Một cặp tiền, quy đổi theo tỷ giá trong ngày                 |
| Thời tiết        | Một nơi, mười hai giờ tới, và cả tuần                        |
| Câu nói mỗi ngày | Mỗi ngày một câu, giống nhau với mọi người                   |
| Nguồn tin        | Tiêu đề từ các nguồn RSS và Atom bạn theo dõi, gom một chỗ   |
| Bản đồ           | Các địa điểm của bạn trên bản đồ, và đường đến đó            |
| Thị trường       | Danh sách theo dõi tiền mã hoá và cổ phiếu, nhìn là thấy     |
| Nhạc             | Nhạc của chính bạn, từ một thư mục hoặc các tệp bạn thêm vào |
| Video            | Phát video từ thiết bị, có phụ đề và hình trong hình         |

Mỗi tile mở ra một phần chi tiết với nhiều nội dung hơn, và bảng tile tự điều
chỉnh từ một cột trên điện thoại đến mười hai cột trên màn hình rộng.

## Quyền riêng tư, nói ngắn

Mã của TilePier không đặt cookie nào và không gửi thông tin gì về bạn đi đâu.
Hai dịch vụ của Cloudflare thấy một lượt truy cập:

- **Web Analytics**, không dùng cookie, đếm lượt xem trang mà không nhận
  diện ai.
- **Turnstile**, bước kiểm tra bot trước các điểm lấy dữ liệu. Khi vượt qua,
  nó để lại cookie bảo mật duy nhất của Cloudflare, `cf_clearance`.

Không nơi nào khác được liên hệ cho tới khi bạn mở bản đồ: ảnh bản đồ đến
thẳng từ OpenFreeMap, và tile bản đồ báo trước điều đó trước lần tải đầu tiên.
[Trang quyền riêng tư](https://tilepier.win/legal/privacy) có toàn bộ chi tiết.

## Xây dựng bằng

SvelteKit và Svelte 5 trên Cloudflare Workers, cùng gridstack, ECharts,
MapLibre với bản đồ OpenFreeMap, Dexie, Paraglide, marked với DOMPurify và
music-metadata. Dữ liệu đến từ Open-Meteo, ExchangeRate-API, Binance.US,
Finnhub, Twelve Data, Photon và Nominatim. Mọi nguồn và mọi giấy phép đều được
ghi nhận ở [trang giấy phép](https://tilepier.win/legal/licenses).

## Chạy trên máy

Cần Node 24 và pnpm 11 (corepack cung cấp sẵn).

```bash
corepack enable
pnpm install
pnpm dev
```

Hầu hết các tile chạy mà không cần khoá. Phần cổ phiếu của Thị trường cần khoá
Finnhub và Twelve Data: chép `.dev.vars.example` thành `.dev.vars` rồi điền vào.

```bash
pnpm verify      # mọi thứ CI chạy: lint, mã chết, i18n, test, build, ngân sách
pnpm test:e2e    # bộ Playwright, chạy trên Worker đã build
```

[CONTRIBUTING.md](CONTRIBUTING.md) nói cách thay đổi được đưa vào đây.
[docs/self-hosting.md](docs/self-hosting.md) hướng dẫn chạy bản của riêng bạn.
Báo lỗi bảo mật đi qua [SECURITY.md](SECURITY.md), không bao giờ qua issue
công khai.

## Giấy phép

[GPL-3.0-only](LICENSE). Các nguồn dữ liệu và thư viện giữ giấy phép riêng của
chúng, được liệt kê đầy đủ ở trang giấy phép.

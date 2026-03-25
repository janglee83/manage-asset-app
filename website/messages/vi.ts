/**
 * messages/vi.ts — Vietnamese UI strings
 */
import type { Messages } from "./en";

export const vi: Messages = {
  nav: {
    docs: "Tài liệu",
    features: "Tính năng",
    download: "Tải xuống",
  },
  hero: {
    badge: "v{version} — Hỗ trợ nhúng vector với GPU acceleration",
    headline1: "Tìm bất kỳ tài nguyên thiết kế nào",
    headline2: "bằng ngôn ngữ tự nhiên",
    description:
      "AssetVault lập chỉ mục toàn bộ thư viện thiết kế của bạn bằng CLIP AI và cho phép tìm kiếm theo nghĩa — qua hơn 100 ngôn ngữ, từ ảnh tham chiếu hoặc mô tả. Tất cả chạy",
    descriptionEmphasis: "hoàn toàn trên máy của bạn",
    ctaDownload: "Tải xuống miễn phí",
    ctaDocs: "Đọc tài liệu",
    ctaGithub: "Mã nguồn mở",
    stat1Value: "100+",
    stat1Label: "ngôn ngữ được hỗ trợ",
    stat2Value: "< 25 ms",
    stat2Label: "độ trễ tìm kiếm (sau khởi động)",
    stat3Value: "200K+",
    stat3Label: "tài nguyên đã kiểm thử",
    stat4Value: "0 byte",
    stat4Label: "gửi lên đám mây",
  },
  features: {
    sectionLabel: "Tính năng",
    sectionTitle: "Tất cả những gì tìm kiếm thiết kế cần",
    sectionDescription:
      "Sáu tính năng tích hợp sâu, được tích hợp bởi CLIP, FAISS và EasyOCR — tất cả chạy cục bộ trong vòng 25 ms.",
    items: {
      semantic: {
        title: "Tìm kiếm ngữ nghĩa",
        description:
          "Mô tả những gì bạn cần bằng tiếng Việt. CLIP hiểu ý nghĩa, không chỉ từ khóa — tìm 'giao diện tối với biểu đồ' mà không cần tag.",
      },
      multilingual: {
        title: "Đa ngôn ngữ",
        description:
          "Tìm kiếm bằng Tiếng Nhật, Tiếng Ả-rập, Tiếng Tây Ban Nha hay hơn 100 ngôn ngữ khác. Không gian nhúng chung của CLIP ánh xạ câu truy vấn đến kết quả đúng.",
      },
      image: {
        title: "Tìm kiếm bằng hình ảnh",
        description:
          "Kéo thả ảnh tham chiếu vào thanh tìm kiếm. AssetVault ngay lập tức tìm tài nguyên tương tự. Kết hợp với văn bản — 'như ảnh này nhưng gam tối hơn'.",
      },
      duplicate: {
        title: "Phát hiện trùng lặp",
        description:
          "Ba cấp độ phát hiện: chính xác (SHA-256), nhận thức (pHash hamming ≤ 10) và ngữ nghĩa (cosine similarity). Xem xét và xử lý hàng loạt chỉ một cú nhấp.",
      },
      privacy: {
        title: "Bảo mật tuyệt đối",
        description:
          "Mọi vector, ảnh thu nhỏ và tag đều được lưu trong SQLite cục bộ. Không telemetry. Không gọi cloud API. Yêu cầu ra ngoài duy nhất là kiểm tra phiên bản (tùy chọn).",
      },
      offline: {
        title: "Hoạt động ngoại tuyến",
        description:
          "Sau lần tải model đầu tiên, AssetVault hoạt động hoàn toàn không cần internet. Thư viện của bạn luôn truy cập được, dù trên máy bay hay sau tường lửa công ty.",
      },
    },
  },
  architecture: {
    sectionLabel: "Kiến trúc",
    title: "Sáu tầng, không có đám mây",
    description:
      "AssetVault sử dụng kiến trúc ba tiến trình: giao diện React giao tiếp qua IPC định kiểu của Tauri, Rust quản lý toàn bộ I/O đĩa và SQLite, Python sidecar xử lý AI inference qua JSON-RPC cục bộ.",
    points: [
      "Frontend không có quyền truy cập filesystem — chỉ qua IPC",
      "Sidecar không có socket mạng — chỉ stdin/stdout",
      "SQLite là nơi lưu trữ trạng thái duy nhất; FAISS là kho vector duy nhất",
      "CLIP và FAISS chạy hoàn toàn trong tiến trình — không có API ngoài",
    ],
  },
  platforms: {
    sectionLabel: "Nền tảng hỗ trợ",
    title: "Hoạt động ở mọi nơi bạn làm việc",
    description: "Bộ cài đặt gốc cho mọi hệ điều hành và kiến trúc CPU chính.",
    accelerationTitle: "Apple Silicon M1 / M2 / M3",
    accelerationDesc:
      "Thực thi arm64 gốc — không cần Rosetta, nhúng CLIP nhanh hơn 3× qua Metal GPU (MPS)",
    cudaTitle: "Tăng tốc GPU CUDA",
    cudaDesc:
      "Tự động phát hiện trên Windows / Linux — giảm thời gian nhúng lên đến 6×",
    cpuTitle: "Dự phòng CPU",
    cpuDesc: "Inference CPU OpenBLAS trên mọi nền tảng không cần cài đặt thêm",
  },
  whyLocal: {
    sectionLabel: "Tại sao Local-First",
    title: "Riêng tư và tốc độ theo mặc định",
    description:
      "Công cụ thiết kế đám mây đánh đổi dữ liệu của bạn để lấy sự tiện lợi. AssetVault cho bạn cả hai — không cần đánh đổi.",
    compareCapability: "Tính năng",
    compareAsset: "AssetVault",
    compareCloud: "Công cụ đám mây",
    rows: [
      "Hoạt động ngoại tuyến",
      "Không upload dữ liệu",
      "Không cần API key/quota",
      "Tìm kiếm dưới 30 ms",
      "Bậc miễn phí",
      "100+ ngôn ngữ",
    ],
    items: [
      {
        title: "Tệp của bạn không bao giờ rời khỏi máy",
        description:
          "Vector CLIP, ảnh thu nhỏ, tag và lịch sử tìm kiếm đều lưu trong SQLite cục bộ. Không telemetry. Không upload cloud. Công việc bảo mật luôn được bảo vệ.",
        stat: "0 byte",
        statLabel: "gửi đến bất kỳ server nào",
      },
      {
        title: "Tìm kiếm dưới 30 ms",
        description:
          "Tra cứu FAISS mất 3-5 ms. Toàn bộ vòng từ phím bấm đến kết quả hiển thị mất ~25 ms với thư viện 50 000 tài nguyên.",
        stat: "< 25 ms",
        statLabel: "độ trễ tìm kiếm (sau khởi động)",
      },
      {
        title: "Không phụ thuộc dịch vụ ngoài",
        description:
          "Không API key cần quản lý, không quota giới hạn, không vendor lock-in. Tìm kiếm của bạn hoạt động trên máy bay, tại khách hàng hay sau tường lửa.",
        stat: "100%",
        statLabel: "uptime (ngoại tuyến)",
      },
      {
        title: "Không cần đăng ký cho tính năng cốt lõi",
        description:
          "Tìm kiếm ngữ nghĩa, tìm kiếm hình ảnh, phát hiện trùng lặp và hỗ trợ đa ngôn ngữ đều có trong bậc miễn phí lên đến 5 000 tài nguyên. Không cần thẻ tín dụng.",
        stat: "Miễn phí",
        statLabel: "đến 5K tài nguyên",
      },
    ],
  },
  download: {
    sectionLabel: "Tải xuống",
    title: "Tải AssetVault miễn phí",
    subtitle:
      "Miễn phí đến 5 000 tài nguyên. Không cần tài khoản, thẻ tín dụng hay telemetry.",
    detectedLabel: "Đã phát hiện:",
    primaryCta: "Tải xuống cho {platform}",
    versionNote: "v{version} — bộ cài {format}",
    selectPlatform: "Chọn nền tảng",
    allReleases: "Xem tất cả bản phát hành trên GitHub",
  },
  docsCta: {
    badge: "Tài liệu đầy đủ",
    title: "Tài liệu toàn diện,\nmã nguồn mở",
    description:
      "Mọi thành phần đều được ghi tài liệu — schema SQLite, bề mặt lệnh Rust, giao thức JSON-RPC của Python sidecar, cấu trúc FAISS index và mô hình bảo mật.",
    cta: "Xem tài liệu",
  },
  faq: {
    sectionLabel: "FAQ",
    title: "Câu hỏi thường gặp",
    items: [
      {
        q: "AssetVault có gửi ảnh lên cloud AI không?",
        a: "Không. CLIP, EasyOCR và tất cả AI model đều chạy cục bộ trong Python sidecar. Không có ảnh, vector hay metadata nào được truyền ra ngoài.",
      },
      {
        q: "Lập chỉ mục thư viện lớn mất bao lâu?",
        a: "Quét ban đầu nhanh — khoảng 70 giây cho 50 000 tệp trên M1 Pro. Nhúng vector mất khoảng 7 phút CPU, 2,5 phút với Metal GPU, hoặc 70 giây với CUDA.",
      },
      {
        q: "Nếu sidecar bị crash thì sao?",
        a: "AssetVault phát hiện sidecar chết và hiển thị thông báo. Bạn có thể khởi động lại từ Settings → Intelligence mà không mất dữ liệu SQLite.",
      },
      {
        q: "Có dùng được với file Figma hay Sketch không?",
        a: "Có. File Figma export, Sketch, SVG, PSD và AI đều được hỗ trợ đầy đủ và được ưu tiên trong thứ tự quét.",
      },
      {
        q: "Có giao diện dòng lệnh không?",
        a: "Chưa có, nhưng đang trong lộ trình. Codebase Rust được cấu trúc để wrapper CLI có thể thêm vào mà không thay đổi logic lõi.",
      },
      {
        q: "Cập nhật lên phiên bản mới như thế nào?",
        a: "AssetVault kiểm tra cập nhật khi khởi động (tùy chọn). Tải bộ cài từ trang release và chạy lên bản đã cài — thư mục dữ liệu và index được giữ nguyên.",
      },
      {
        q: "Thư viện tối đa bao nhiêu tài nguyên?",
        a: "Đã kiểm thử với đến 200 000 tài nguyên. Trên 1 triệu, FAISS sẽ dùng hơn 2 GB RAM. Index phân mảnh IVF cho thư viện rất lớn đang được lên kế hoạch.",
      },
      {
        q: "Có tìm kiếm theo bảng màu không?",
        a: "Có. Thêm 'color:red' hay 'palette:blue tones' vào truy vấn và module tìm kiếm màu sẽ lọc theo độ tương đồng màu. Bạn cũng có thể dùng bộ lọc Màu sắc trong sidebar.",
      },
    ],
  },
  footer: {
    tagline:
      "Tìm kiếm AI cục bộ cho thư viện thiết kế của bạn. Mã nguồn mở. Ưu tiên bảo mật.",
    copyright: "© {year} AssetVault. Giấy phép MIT.",
    builtWith: "Được xây dựng với Next.js, Tailwind CSS, Tauri, Rust và Python.",
    product: "Sản phẩm",
    links: {
      download: "Tải xuống",
      changelog: "Nhật ký thay đổi",
      issues: "Báo lỗi",
      documentation: "Tài liệu",
      security: "Bảo mật",
    },
  },
};

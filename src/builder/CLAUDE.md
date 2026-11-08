# Role 1 (Rocket Builder): sổ tay trao đổi giữa Quoc Thai (Myklede) và AI

File này lưu mọi điều đã thống nhất về phần xây tàu. Claude Code tự đọc nó khi làm việc trong `src/builder/`.
File `CLAUDE.md` ở gốc repo là của cả nhóm (chỉ Role 3 được sửa), nên ghi chú của Role 1 nằm ở đây.
Cập nhật file này sau mỗi lần trao đổi có quyết định mới. Ghi ngày, ghi rõ "đã chốt" hay "đang bàn".

## 1. Bối cảnh cố định

- Người dùng: Quoc Thai Nguyen (Michael, GitHub Myklede), **Role 1: Rocket Builder** của game SpaceB&E (4 người, hackathon). Trao đổi bằng tiếng Việt.
- Nhánh làm việc: `role1-builder`. Đưa lên `dev` chỉ khi người dùng bảo: `git merge origin/dev`, `npm run check`, `git push origin HEAD:dev`. Không bao giờ push `main`, không force-push, không `--no-verify`.
- **Người dùng chốt (2026-11-07):** nhánh `dev` của cả nhóm phải giữ nguyên. AI không tự gộp `dev` vào `role1-builder` và không đụng vào `dev`, chỉ làm khi người dùng bảo. Khi kiểm tra thì chạy các test builder và `check:boot`. Dòng "branch does not contain origin/dev" của `check:static` là bình thường.
- Chỉ sửa: `src/builder/**`, `src/core/balance.json`, `README.md`, `CREDITS.md`, `docs/DECISIONS.md`, `docs/SHARE_PROBLEMS.md`, `public/assets/**`. Lỗi ở phần người khác thì ghi vào `docs/SHARE_PROBLEMS.md`.
- Không tự đặt tên event, state, ending, task, station mới: tất cả nằm trong `src/core/contract.js`. Thêm trường phụ vào `ShipSpec.stats` / `ShipSpec.launch` thì được (Role 2 bỏ qua trường lạ), nhưng phải ghi vào DECISIONS.
- Luật kiểm tra: chuột/bàn phím chỉ qua `core/input.js` (trong builder chỉ dùng `click`, `wheel`, `drag*`); không `requestAnimationFrame`; không viết số `9.81 / 3.71 / 9.80665`; `localStorage` chỉ qua `save`.
- Máy: Node 26, chạy thẳng `npm run dev` / `npm run check`. Sau `npm install` phải hoàn tác `package-lock.json` (`git checkout origin/dev -- package-lock.json`).
- Mô phỏng bay của Role 2 chỉ có **một tầng**: không tách tầng. Mọi thứ gắn lên tàu bay tới Sao Hỏa.
- Kiểm tra trước khi báo cáo: `node src/builder/tests/builder.test.mjs`, `npm run check`, và chụp ảnh màn hình bằng Playwright để tự xem giao diện.

## 2. Sở thích của người dùng (rút ra qua các lần góp ý)

- Ghét giao diện rườm rà, nhiều nút, nhiều mảnh nhỏ lẻ tẻ; muốn gọn, có tổ chức, thân thiện với người chơi phổ thông.
- Mọi linh kiện phải có hình ảnh; công thức và thông số phải giải thích bằng lời dễ hiểu.
- Muốn sát thực tế: hình dáng, linh kiện, vật liệu lấy từ tàu và tên lửa thật (NASA, SpaceX…), đi sâu tới từng chi tiết (ống xả, ống dẫn nhiên liệu…). Ốc vít nhỏ thì bỏ qua.
- Thích khung 3D xoay được của tàu (đã khen ngày 2026-11-07).
- Muốn người chơi tự do build cả con tàu từ đầu, có nút xoá hết.

## 3. Lịch sử giao diện xây tàu

| Lần | Giao diện | Kết quả |
|---|---|---|
| 1 | Màn phẳng: palette + Formula Lens | Chê đồ hoạ giả |
| 2 | Phòng kỹ thuật tròn đi bộ góc nhìn thứ nhất, mỗi máy một việc | **Giữ** |
| 3 | Hologram kéo thả kiểu Iron Man | **Bỏ**, quá nhiều nút, hình nhỏ |
| 4 | Trang sơ đồ Dawn 2D, thẻ to | Thẻ chiếm chỗ, không xoay được |
| 5 | Studio 3D xoay được + dải thẻ nhỏ + bảng phải + nhãn có đường dẫn (commit `7e17832`) | 3D xoay **tốt**; nhãn và mảnh nhỏ **lộn xộn**, chưa ưng |

## 4. Trang thiết kế 4 thẻ (2026-11-07, ĐÃ LÀM XONG)

Người dùng muốn làm lại giao diện trang thiết kế:

- Giữ khung 3D tàu xoay được ở giữa.
- Bỏ các nhãn lẻ tẻ có đường dẫn quanh tàu.
- Bên ngoài chỉ có **4 thẻ**: (1) Mũi tàu, (2) Thân tàu, (3) Đít tàu, (4) Bệ phóng.
- Bấm một thẻ → hiện **danh sách dọc** các thành phần và linh kiện của phần đó để chọn tuỳ ý. Áp dụng như nhau cho cả 4 phần.
- Có nút **xoá hết**: bệ trống, không có tàu, chỉ còn 4 thẻ. Người chơi bắt đầu từ phần nào cũng được.
- Trong mỗi phần: chọn **hình dáng trước** (ví dụ đáy rộng / đáy hẹp, nhiều lựa chọn lấy từ tàu thật), rồi **đi sâu** vào từng bộ phận, từng thiết bị (ống xả, ống dẫn nhiên liệu…) như linh kiện thật.
- Làm bằng **đội sub-agent**: mỗi agent thực thi phụ trách một phần, mỗi agent kiểm tra soát một agent thực thi, kết quả báo lại cho người dùng.

### Đề xuất của AI (chờ người dùng chốt)

- Bố cục: thanh trên tối giản; 3D ở giữa; cột 4 thẻ một bên. Bấm thẻ thì thẻ mở thành danh sách dọc (bước 1 hình dáng → bước 2 thành phần → bước 3 bên trong). Tàu 3D tô sáng phần đang chọn, camera bay tới phần đó, các phần khác mờ đi.
- Chia linh kiện hiện có (dự kiến):
  - Mũi: fairing/mũi, capsule, tấm chắn nhiệt, payload adapter, dù, ăng-ten, thiết bị phi hành đoàn.
  - Thân: bồn, vòng điện tử, truss, interstage, centerbody, wiring tunnel, bình helium/nitơ, đồ gắn trên bồn (khoa học, điện, O₂, che chắn).
  - Đít: động cơ, khung đỡ lực đẩy, gimbal, vây, chân đáp, động cơ rắn gắn hông.
  - Bệ phóng: cửa sổ phóng và thời tiết, thiết bị bệ (kẹp giữ, tháp, máng lửa, phun nước), thử động cơ.
- Hệ quả kỹ thuật cần thống nhất:
  - "Hình dáng đít" từ tàu thật (Falcon 9 có 9 động cơ, Saturn V có 5…) cần cụm nhiều động cơ: thêm phần "khung đỡ lực đẩy" có N vị trí gắn động cơ.
  - Thân rộng/hẹp khác nhau cần bộ chuyển đường kính.
  - Bệ phóng là nhóm mới, chỉ ảnh hưởng giá, độ tin cậy, thời tiết. Cảnh phóng thật thuộc Role 3/2, không đổi được.
- Đội agent: AI dựng khung chung trước (dữ liệu "phần", khung thẻ, 3D tô sáng), sau đó 4 agent thực thi chạy song song, mỗi agent một file riêng; 4 agent kiểm tra đọc code, chạy test, chụp ảnh, báo lỗi; AI tổng hợp và báo lại người dùng.

### ĐÃ CHỐT (2026-11-07, người dùng chọn cả 4 đề xuất)

1. **Bệ phóng** = thiết bị bệ (loại bệ, tháp, kẹp giữ, máng lửa, phun nước giảm âm, chống sét…) + địa điểm và cửa sổ phóng, thời tiết. Ảnh hưởng phí, độ tin cậy, nhiệt độ lúc phóng (kết cục Challenger). Bệ hiện trong khung 3D dưới tàu.
2. **Thiết bị theo vị trí thật**: Mũi = khoang lái + đồ phi hành đoàn (dù, ăng-ten, O₂, chắn bức xạ, RCS…); Thân = bồn + đồ gắn trên bồn (khoa học, điện, bảo vệ, bình áp…); Đít = động cơ, khung đỡ lực đẩy, vây, chân đáp, động cơ rắn gắn hông.
3. **Cụm nhiều động cơ theo mẫu tàu thật**: hình dáng đít (khung đỡ lực đẩy) quyết định số vị trí động cơ; người chơi chọn loại động cơ cho cả cụm; lực đẩy, khối lượng, giá nhân theo số động cơ.
4. **Đội agent 4 thực thi + 4 kiểm tra**: Mũi, Thân, Đít, Bệ phóng. AI dựng khung chung trước, rồi mới chạy agent.

### Kiến trúc khung chung (AI làm ở Bước 0)

- Mỗi phần có thư mục riêng `src/builder/sections/<nose|body|tail|pad>/`: `section.json` (hình dáng + danh sách dòng thành phần), `parts.json` (linh kiện của phần đó), `internals.json` (chi tiết bên trong), `art.js` (hình 3D). Mỗi agent thực thi chỉ sửa thư mục của mình.
- Mỗi linh kiện có trường `section`. Linh kiện xếp chồng theo thứ tự Mũi → Thân → Đít. Chọn một hình dáng thì thay phần đó, giữ nguyên các phần khác; thiết bị của phần khác được chuyển sang chỗ gắn mới.
- Khung đỡ lực đẩy có `mounts` (số động cơ, vị trí, tỉ lệ); động cơ ngay dưới nó được nhân theo số vị trí.
- Bệ phóng không phải linh kiện của tàu: lưu trong `assembly.launch` (địa điểm, cửa sổ, thiết bị), cộng vào phí phóng và độ tin cậy.
- Giao diện: không còn nhãn quanh tàu; cột phải có 4 thẻ dạng accordion, mở ra danh sách dọc (hình dáng → thành phần → lựa chọn → bên trong); tàu 3D tô sáng phần đang mở.

### Tiến độ

- 2026-11-07: **Bước 0 xong** (commit `4b14585`, `78ee088`): khung 4 thẻ, `sections.js`, dữ liệu tách theo phần, cụm động cơ, bệ phóng, adapter tự động, động cơ tự khớp nhiên liệu với bồn. Test + `npm run check` qua.
- 2026-11-07: **4 agent thực thi đang chạy** (Mũi 5191, Thân 5192, Đít 5193, Bệ 5194), mỗi agent chỉ sửa `sections/<id>/`. Đề bài chung: scratchpad `brief-common.md`; đề bài kiểm tra: `brief-review.md`. Sau mỗi agent thực thi, một agent kiểm tra soát lại; AI tổng hợp, chạy check, commit, báo người dùng.

- 2026-11-07: người dùng muốn **xem game chạy trong lúc làm**, trang tự tải lại khi có thay đổi. Server dev của người dùng ở `http://localhost:5173` (Vite tự reload khi file đổi). Link mở thẳng bàn thiết kế: `http://localhost:5173/?debug=1&state=HANGAR&station=integration` (tham số `station` mới, commit `72113d6`).

- 2026-11-07: **4 agent thực thi đã xong** (chưa commit, đang chờ kiểm tra):
  - Thân: 11 hình dáng, 15 linh kiện mới.
  - Bệ phóng: 9 bãi phóng, 8 nhóm thiết bị.
  - Đít: 11 hình dáng, 16 linh kiện mới, động cơ vẽ lại.
  - Mũi: 9 hình dáng, 15 linh kiện mới, tháp thoát hiểm, capsule vẽ lại.
  AI đã sửa code chung theo đề nghị của các agent (commit `11c7cee`, `ffdbafb`): bệ vẽ lại theo kích thước tàu, bỏ bảng Range cũ, động cơ vẽ lại khi đổi vòi, booster tính trọng tâm ở giữa, buồng đốt và vòi theo cỡ bơm, vây của preset có `origin: tail`. 4 agent kiểm tra đang chạy (cổng 5195–5198).

- 2026-11-07: **4 agent kiểm tra xong, cả 4 đều "chấp nhận kèm lỗi cần sửa"**, không có lỗi chặn. Đã gửi danh sách lỗi cho 4 agent thực thi sửa. AI sửa code chung (`4bbbfbc`, `b1a2e3f`, `e8c5759`):
  - Hình vẽ biết bộ phận trên/dưới; shape mang sẵn lựa chọn và vật liệu; bỏ ánh xanh.
  - Có bộ lái thì chịu được mất ổn định nhẹ (6 %); bonus cùng nhóm chỉ tính một lần.
  - Shape thay đồ cũ trong các hàng nó lắp (hết trùng chân, dù, ăng-ten).
  - Trọng tâm booster tại +0.25 H; vây Workhorse xoay khỏi góc booster.
- 2026-11-07: **4 agent thực thi sửa xong theo kiểm tra; AI tự soát (test, ảnh chụp) rồi commit từng phần**: Thân `7aff784`, Đít `4dc9bca`, Mũi `b208b7e`, Bệ phóng `cd1d279`. Không chạy lại agent kiểm tra.
  - Thân: kit bồn hydro (mặc định bọc foam), bồn hydro vách chung, một băng intertank giữa hai bồn kề nhau, ống dẫn ET đúng chỗ, bồn thép rẻ, tuỳ chọn tổ ong.
  - Đít: mọi cụm động cơ có gimbal; bộ lái (gimbal, verniers, jet vanes) chung nhóm bonus; Saturn V động cơ góc nằm dưới fairing; booster lỏng đắt hơn. Trên thân Reliable: chỉ One big engine và Soyuz không cảnh báo; các kiểu có solid thiếu 130–510 m/s; Octaweb TWR 1,18; Saturn V và New Glenn quá $5M; Soyuz chỉ dư ~$10k.
  - Mũi: fairing và nắp nhận tháp thoát hiểm ở trên; fairing trùm capsule có váy trong suốt; hệ thoát hiểm chung nhóm bonus; Apollo và Orion vừa $5M (khi thêm bồn + 2 solid + gimbal); ăng-ten vẽ phẳng trên vỏ.
  - Bệ phóng: giá bãi so với chờ ở Cape; Baikonur, Plesetsk miễn phí nhưng dưới 0 °C cả tuần; tháp lùi tránh vây, chân, booster; tay với chạm đúng vỏ; kẹp móc dưới bồn thấp nhất; tuyết khi dưới 0 °C. `pad/art.js` đọc `surfaceRadius` từ `nose/art.js` (cùng Role 1).
- 2026-11-07: **tích hợp**: vẽ lại 320 ảnh thẻ; `autoplace.js` coi fairing là mũi; tổng tiền trên thẻ phần tính đủ cụm động cơ (test mới); `npm run check` qua; cập nhật `README.md`, `README-ARCH.md`, `docs/DECISIONS.md`; SHARE_PROBLEMS: Role 3 thêm ~80 mã linh kiện chưa có hình bay, Role 2 `stats.reliability` không dùng khi bay (severity decision). Chưa push lên dev.

## 4b. Có cảnh báo cho người chơi hay để tai nạn xảy ra? (2026-11-07, đã chốt ở mục 6)

- Người dùng hỏi: nên báo "No spare oxygen", "Not enough Δv…" hay giấu đi để người chơi tự trải nghiệm tai nạn.
- AI đề xuất hướng giữa: (1) trong trang thiết kế chỉ hiện con số (Δv / cần), bỏ câu chỉ cách sửa, thêm "Why?" mở Formula Lens; (2) Go/No-Go vẫn đọc NO-GO kèm lý do, người chơi được OVERRIDE (spec §5.5 và contract đã chốt, các ending dựa vào đây; bài học Challenger/Columbia là cảnh báo có nhưng bị bỏ qua); (3) không cảnh báo những gì phụ thuộc cách lái và độ tin cậy ẩn; (4) màn kết thúc nối lại nguyên nhân (Role 4); (5) tuỳ chọn chế độ "Veteran" trong Settings.
- **Người dùng trả lời (2026-11-07):** đồng ý hướng xác suất "kiểu cầu thủ FIFA": bộ phận càng đắt càng chắc chắn nhưng vẫn có thể hỏng; đồ rẻ đôi khi vẫn thành công; liều khi Δv thiếu một chút đôi khi vẫn tới nơi (kịch tính khi sắp hết tiền). **Không nhắc lộ liễu** trong lúc lắp (chán nếu "cần 5000, lắp đúng 5000, bay thành công"). Khi thất bại thì **hiện phân tích nguyên nhân** để lần sau người chơi tự tính kỹ hơn.
- AI đề xuất cách làm (chờ người dùng chốt chi tiết): tàu thực tế lệch quanh thông số thiết kế lúc xác nhận (đồ đắt lệch ít, đồ rẻ lệch nhiều, hiếm khi có lỗi chế tạo); bỏ con số "cần X m/s" và câu chỉ cách sửa trong trang thiết kế; Go/No-Go nói kiểu điều khiển viên, không số, không cách sửa; TEST FIRE tốn tiền có thể phát hiện lỗi động cơ (spec §5.3); "Hội đồng điều tra tai nạn" trong hangar sau chuyến bay hỏng. Nổ/hỏng giữa chuyến cần Role 2.

## 6. Đợt 3 (2026-11-07): may rủi, vỏ liền khối, bệ phóng mới, thẻ giải thích (ĐÃ CHỐT)

### Người dùng đã chốt
- **May rủi kiểu FIFA:**
  - Tàu thực tế lệch quanh thông số thiết kế lúc xác nhận, biên độ nhỏ khoảng ±2%: đồ đắt lệch ít, đồ rẻ lệch nhiều.
  - Hiếm khi có lỗi chế tạo, xác suất bằng 1 − độ tin cậy của bộ phận đó.
  - Liều đôi khi vẫn thành công.
  - TEST FIRE tốn tiền và có thể phát hiện lỗi động cơ.
  - Có hội đồng điều tra tai nạn trong hangar sau chuyến bay hỏng.
- **Không nhắc lộ liễu:**
  - Trang thiết kế chỉ hiện số của tàu, không có "cần X m/s", không có câu chỉ cách sửa, không có dấu "!" (chỉ lỗi cứng).
  - Go/No-Go nói kiểu điều khiển viên, nhắc nhẹ, không số, không cách sửa; vẫn OVERRIDE được.
- **Bệ phóng = bệ dưới đất**, không chọn ngày giờ:
  - Hàng 1: bệ phóng thật có sẵn (LC-39A, SLC-40, Starbase, Gagarin's Start, ELA-3…), mỗi bệ kèm bộ thiết bị và khí hậu.
  - Hàng 2: chỉnh từng thiết bị (máng dẫn lửa, phun nước, kẹp giữ, tháp, chống sét, radar thời tiết…).
  - Bệ đắt chịu lửa nhiều hơn, cho phép hết ga ngay từ đầu.
  - Tàu mạnh hơn sức chịu của bệ thì có đủ bốn hậu quả:
    1. Giảm ga, mất một ít Δv.
    2. Mảnh văng làm hỏng động cơ (may rủi).
    3. Tốn tiền sửa bệ lần sau.
    4. Kẹp giữ tốt bắt lỗi trước khi rời bệ.
- **Thời tiết do game đưa:** dự báo cho ngày phóng theo khí hậu bệ; Go/No-Go có HOLD (chờ thêm một ngày, mất phí). Radar rẻ thì dự báo có thể sai. Cold Morning (demo Challenger) vẫn phải chạy được.
- **Vỏ liền khối:**
  - Game tự bọc vỏ trụ và chóp nón chuyển cỡ để tàu thành một khối.
  - Người chơi chọn vật liệu vỏ cho từng phần (nhôm, nhôm-liti, carbon, thép…).
  - Vỏ ảnh hưởng khối lượng, giá, chịu nhiệt khi bay lên, độ bền ở Max-Q (xác suất gãy), lực cản.
  - Thêm độ bền sau mỗi chuyến, tỷ lệ hỏng, vật lý giống thật.
  - Đồ gắn ngoài (pin, O₂, máy khoa học…) đưa vào trong vỏ; mở thẻ thì vỏ trong suốt. Chỉ những thứ vốn ở ngoài mới ở ngoài: booster, vây, chân, ăng-ten, tháp thoát hiểm.
- **Độ bền = cả hai:**
  - Tái sử dụng tàu sau chuyến về an toàn, phí tân trang rẻ hơn nhưng mỗi chuyến mòn thêm (Role 1 làm).
  - Hao mòn trong chuyến bay ở Max-Q và nhiệt (ghi cho Role 2, cần cả nhóm đồng ý).
- **Thẻ giải thích lớn ở giữa màn hình:**
  - Mở khi bấm vào bộ phận (trên tàu 3D hoặc tên/hình trong cột phải); nút INSTALL nhỏ trong cột phải vẫn còn.
  - Nội dung: (1) nó làm gì và vì sao cần, thiếu thì sao; (2) bên trong hoạt động thế nào (3D tách lớp + từng mảnh); (3) con số nói bằng lời đời thường và so với món đang lắp. Không cần phần lịch sử.
  - Chữ to, thoáng. Tiếng Anh dễ hiểu, có nút EN/VI. Tiếng Việt chỉ ở thẻ lớn và hội đồng điều tra; tiếng Anh là mặc định (spec: UI English).
- **Đội agent:** 5 thực thi + 5 giám sát, Opus 5.5, mức extra high.

### Bước 0 (AI làm, commit `6b34db6`, merge dev `c0989b1`)
- File khung có giao diện cố định:
  - `hull.js` (`computeHull`, `hullChoices`, `hullMaterial`).
  - `weather.js` (`weatherFor`).
  - `sections/pad/effects.js` (`padEffects`).
  - `designPad.js` (thẻ Bệ phóng, tách khỏi `designPage.js`).
  - `i18n.js` (`tr`, `getLang`, `setLang`, `onLang`).
  - `explain.js` và các file `explain*.json`.
- `stats.js` đã cộng khối lượng, giá, lực cản của vỏ và phí, độ tin cậy, Δv mất khi giảm ga của bệ (hiện đều trung tính).
- `assembly` có `hull` và `setHull`, `setLaunch`.
- Trang thiết kế đã bỏ "need", bỏ dấu "!", thêm hàng "3 · Outer skin".

### Chia việc (mỗi agent chỉ sửa file của mình)
1. **Vỏ (hull):** `hull.js`, `bay/hullArt.js` (mới), `assembly.js` (đặt đồ vào trong), `designScene.js`, `hangarScene.js`, `bay/partArt.js`, `sections/{nose,body,tail}/art.js`, `data/hull.json` (mới), `data/explain-hull.json`, `tests/hull.test.mjs`.
2. **Bệ phóng (pad):** `sections/pad/*` (cả `explain.json`), `weather.js`, `designPad.js` (+ `designPad.css`), `data/presets/*.json` (chỉ trường `launch`), `data/launch.json`, `tests/pad.test.mjs`, khối pad trong `tests/builder.test.mjs`.
3. **Thẻ lớn (card):** `partCard.js` (+ `partCard.css`), `designPage.js`, `builder.css` (phần `vd-`), `everyday.js` (con số nói bằng lời, EN/VI), `tests/card.test.mjs`.
4. **May rủi (luck):** `asBuilt.js`, `investigation.js` (+ css), `gonogo.js`, `gonogoView.js`, `data/text.json`, `index.js`, `hangarScreen.js`, `bay/teststand.js`, `tests/luck.test.mjs`.
5. **Lời giải thích (content):** `sections/{nose,body,tail}/explain.json`, `data/explain-general.json`.

## 7. Đợt 4 (2026-11-07): 30 hình dáng thật mỗi thẻ, mô hình Blender (ĐÃ CHỐT)

- **Mục tiêu:** mỗi thẻ (Mũi, Thân, Đuôi, Bệ phóng) có khoảng 30 hình dáng lấy từ tàu và bệ phóng thật, thêm nhiều linh kiện và mảnh bên trong để người chơi tự sáng tạo. Đúng thực tế là quan trọng nhất.
- **Công cụ:** Blender + Python. Agent viết script dựng mô hình theo kích thước thật từ ảnh và bản vẽ NASA, như Role 3 dựng xe tự hành (`scripts/blender/rover.py`). Dùng mô hình miễn phí bản quyền (NASA, Smithsonian CC0, Sketchfab CC0) khi có mẫu tốt. Không dùng AI biến ảnh thành 3D: méo, không ráp khít, vướng bản quyền.
  - Blender 5.2.3 LTS đã cài bằng winget (người dùng cho phép), cùng bản với cả nhóm.
- **Kích thước:** giữ 3 cỡ đường kính (S 1,88 m, M 2,5 m, L 3,38 m). Tàu thật thu theo tỷ lệ về cỡ gần nhất, giữ đúng hình dáng và tỷ lệ.
- **Chất lượng:** cân bằng. Khoảng 20 nghìn tam giác, dưới 400 KB mỗi mô hình (glb nén Draco), texture tối đa 1K, mỗi phần tối đa khoảng 12 MB.
- **Mảnh bên trong:** Blender cho mảnh chính của linh kiện chủ lực (capsule, động cơ, bồn, tháp, bệ). Mảnh phụ giữ hình dựng bằng code.
- **Đội agent:** mỗi phần 3 agent (tìm tài liệu, dựng 3D, kiểm tra), tổng 12 agent, Opus 5.5 mức extra high. Agent kiểm tra soát hai lần: danh sách và nguồn trước khi dựng, rồi kết quả trong game.
- **Thứ tự:**
  - 4 agent tìm tài liệu chạy ngay ở pha A (chỉ ghi vào `C:/Users/Thainguyen/AppData/Local/Temp/spaceb-wave4/<phần>/`).
  - Khi đợt 3 xong, AI dựng chuẩn ráp nối: gốc ở đáy giữa trục, Y hướng lên, mét, vòng nối đúng bán kính, mảnh trong tên `slot_<key>`, linh kiện tự khai báo hình dáng ngoài cho vỏ, bộ nạp `public/assets/models/builder/<phần>/`, test kích thước và dung lượng.
  - Sau đó: pha B (ghi dữ liệu vào repo), agent dựng 3D, agent kiểm tra.
- **Người dùng báo lỗi tỷ lệ:** ở cảnh phóng (LAUNCH, phần của Role 2/3), tàu mảnh và nhỏ, khuất trong tháp cam to và bệ quá lớn. Chưa được sửa trong code mới của cả nhóm. Phần Role 1 sẽ làm:
  - (1) Nối hình tàu của hangar sang cảnh bay qua `assets.setRocketPartArt`.
  - (2) Ghi `docs/SHARE_PROBLEMS.md` cho Role 2: cỡ tháp và bệ theo kích thước tàu.
  - (3) Bệ trong trang thiết kế giữ quy tắc tỷ lệ thật: tháp khoảng 1,1–1,3 lần chiều cao tàu, bệ đỡ khoảng 1,5–2 lần đường kính.
  - **Cả nhóm đã đồng ý (người dùng báo 2026-11-07):** cảnh phóng dùng bệ phóng của Role 1, vì tiền bệ là một phần tiền đóng tàu của Role 1. Role 1 đăng ký `builder:launchPad` và `builder:rocketSkin` qua `assets.register`, thêm `assets.setRocketPartArt`. Role 2 đặt chúng vào cảnh LAUNCH thay tháp của họ. Đã ghi `docs/SHARE_PROBLEMS.md` và `docs/DECISIONS.md` (commit `e202086`). Phần code của Role 1 làm ngay sau khi agent vỏ và agent thẻ xong.

### Tiến độ đợt 4 (2026-11-07)
- Bước 0 xong (commit `1bcb601`): chuẩn ráp nối (`src/builder/tools/blender/README.md`), thư viện `common.py`, ví dụ `examples/tank_example.py`, bộ nạp mô hình `model.builder`, mảnh trong `slot_<key>`, `hullProfile` trong dữ liệu linh kiện, test `tests/models.test.mjs`. Thử bồn mẫu: đúng 4,000 m, bán kính 1,256 m, 5.260 tam giác, 31 KB, game nạp được.
- Pha A: Đuôi xong (31 kiểu, 26 linh kiện, 27 mô hình), Bệ phóng xong (31 bệ, 8 thiết bị mới, 17 mô hình); Mũi, Thân đang chạy. Kiểm tra lần 1 cho Đuôi và Bệ phóng đang chạy.
- **Người dùng chốt:** tàu khổng lồ dùng giảm giá sản xuất loạt (định luật Wright, 85 %: cụm 9 động cơ ≈ 6,5 lần giá một chiếc, 33 động cơ ≈ 18 lần) và là mục tiêu về sau, vượt ngân sách đầu (commit `ef10bab`).
- **Người dùng chốt:** đồ không vừa khoang khô nào thì game **tự thêm khoang thiết bị** (một đoạn vỏ trụ), không gắn hộp lồi ra ngoài.
- **Dữ liệu pha B đã vào repo:**
  - Mũi: 28 kiểu, 97 linh kiện.
  - Thân: 29 kiểu, 75 linh kiện.
  - Đuôi: 31 kiểu, 56 linh kiện, thêm 15 động cơ thật.
  - Bệ phóng: 31 bệ, 36 lựa chọn thiết bị.
  Mọi kiểu giữ lại vẫn bay được trong $5M; tàu lớn hơn là mục tiêu về sau.
- **Mô hình Blender đã vào repo:**
  - Mũi: 65 mô hình, 5,5 MB.
  - Thân: 20 mô hình, 2,2 MB.
  - Đuôi: 44 mô hình, 3,0 MB.
  - Bệ phóng: 25 mô hình, 1,5 MB.
  Script ở `src/builder/tools/blender/<phần>/`.
- **Quy ước kỹ thuật AI đặt thêm** (ghi trong `tools/blender/README.md`):
  - Mỗi mảnh trong chỉ hiện kiểu đang chọn (`slot_<key>__<optionId>`; nút trơn là lựa chọn đầu tiên).
  - Một mảnh có thể ẩn mảnh khác (`hides`).
  - Động cơ có bản vòi chân không riêng (`vac`) và bản nhẹ cho cụm trên 9 động cơ (`lod`).
  - Mesh đặt tên `m_<node>`.
  - `wrapModel` của từng phần thêm thứ mô hình không biết trước (váy trong suốt của fairing).
  - Mô hình mặt đất dựng cho tàu mẫu 20 × 2,5 m, kéo giãn theo một trục.
- **Kiểm tra lần 2 xong cả 4 phần (2026-11-08)**, đều "chấp nhận kèm lỗi cần sửa", tất cả đã sửa và commit:
  - Bệ phóng `3bdcf11`.
  - Thân: `daaaaac`, `2f3e0ac`, `df0a16c`; khoang thiết bị mang màu của tầng `da46195`.
  - Đuôi: `408af2a` (chân đáp giữ lại khi đổi đuôi; đổi kiểu không còn đứng hình), `2a23870` (lựa chọn sai nhiên liệu bị làm mờ), `5b021c7`.
  - Mũi: `8e5e41b` (hết rò bộ nhớ; không bộ phận nào đạt 100 %; Voskhod không xoá O₂), `816c256` (Orion, Dragon, tấm chắn nhiệt, ngân sách).
  - Ảnh thẻ vẽ lại `be26ade` (563 ảnh).

## 8. Đợt 5 (2026-11-08): bộ phận ảnh hưởng thật khi bay (ĐÃ CHỐT)

- **Người dùng muốn:**
  - Chỉ số mỗi bộ phận khác nhau theo giá thì phải khác nhau cả lúc bay và lúc chơi, để người chơi cảm nhận và cân nhắc.
  - Ví dụ: động cơ hoặc bệ rẻ thì bay lên chậm; bình O₂ xịn thì đi bộ ngoài trời lâu hơn; vỏ titan bền và chịu va đập tốt hơn nhôm.
- **Đã chốt với người dùng:**
  - **Ai làm:** cả 4 người đã đồng ý cho Role 1 làm luôn phần bay (`src/flight`, `src/surface`, `src/cruise`, `src/missions`), nhưng phải ghi `docs/SHARE_PROBLEMS.md` để báo cả nhóm. Đã ghi mục "Role 1 is adding part effects…" và `docs/DECISIONS.md`. Khi chạy `npm run check` cho các file này cần `ALLOW_OWNERSHIP_CHANGE=1`, vì người dùng nói cả 4 đã đồng ý.
  - **Phạm vi:** tất cả, càng sát thực tế càng tốt:
    - động cơ và bệ phóng;
    - vỏ và khung;
    - sự sống của phi hành gia;
    - hạ cánh, điện, liên lạc.
  - **Cách cảm nhận:**
    - Ngay khi bay, nhưng **không thông báo gì**: người chơi tự cảm nhận.
    - Sau chuyến bay có bảng phân tích, ví dụ vỏ titan thì % hao mòn tăng rất chậm.
    - Bệ phóng xịn thì tàu rời bệ rất nhanh, bệ rẻ thì chậm.
  - **Nguyên tắc:** vật lý thật, có đánh đổi. Không phải "đắt hơn là tốt hơn mọi mặt".
  - **Nhánh:** người dùng cho gộp `dev` vào `role1-builder` (merge `38e0f50`); nhánh `dev` không đổi.
  - **Đội agent:** 5 thực thi + 5 kiểm tra, Opus 5.5 mức extra high:
    - (1) động cơ và bệ phóng;
    - (2) vỏ, khung và tấm chắn nhiệt;
    - (3) sự sống (O₂, CO₂, nước, bức xạ, hành trình);
    - (4) hạ cánh, điện, liên lạc;
    - (5) bảng phân tích sau chuyến và hao mòn.
- **Người dùng chốt về oxy (2026-11-08):**
  - Làm như thật, nhưng vẫn phải tính toán để thử thách người chơi.
  - Bình xịn thì đỡ phải tính; bình rẻ thì hết nhanh, phải tính kỹ.
  - Hiện số liệu thật cho Reliable khoảng 11 lần ra ngoài, quá dư.
  - Cần cân chỉnh bằng các yếu tố thật: phi hành đoàn thở suốt 259 ngày hành trình (0,84 kg/người/ngày), trừ khi có vòng tái tạo O₂; bình rẻ nhỏ và áp suất thấp; mỗi lần ra ngoài xả khí khoang; bình rò rỉ.
  - Mục tiêu: rẻ nhất khoảng 2–3 lần ra ngoài, tầm trung khoảng 5–6, xịn nhất từ 10 trở lên.
- **Khung chung (AI làm ở bước 0):**
  - `src/builder/traits/` (`index.js` cùng 4 nhóm `.js` và `.json` số liệu thật) tính `ShipSpec.stats.traits`, kèm `minThrottle` và `ignitions` mà FlightController đã đọc sẵn.
  - `src/flight/effects/` (`index.js` và 3 nhóm) gồm các điểm móc trong FlightController: `params`, `thrust`, `ignite`, `maxQ`, `heatLimit`, `touchdownLimit`, `turnAccel`, `debrisHit`, `step`, `liftoff`, `end`.
  - Bản ghi mỗi chuyến lưu ở `save.partEffects` để hangar phân tích. Hook giá trị phải thuần, không gieo xúc xắc, vì bản sao dự đoán quỹ đạo cũng gọi chúng.
  - Chưa có số liệu thì tàu bay y như cũ; test của Role 2 vẫn qua hết.
- **Xong đợt 5 (2026-11-08):**
  - 5 agent làm và 5 agent kiểm tra; mỗi phần soát một lần, sửa hết các lỗi tìm ra. Toàn bộ test của 4 role đều qua; `check:boot` qua.
  - Kết quả 4 tàu mẫu (30 chuyến mỗi tàu, có mảnh vụn): Reliable 30/30 hạ cánh, Workhorse 30/30, Cold Morning 29/30 kết thúc Challenger, Thin Skin 30/30 kết thúc Columbia.
  - **Quyết định AI đã chốt** (người dùng có thể đổi):
    - TEA-TEB 6 lần đánh lửa.
    - 4 đuôi Atlas V, Angara, Ariane 5, Ariane 64 mặc định dùng đánh lửa điện.
    - Độ mòn theo đường cong Falcon 9: gần như không giảm độ tin cậy trước nửa đời bộ phận.
    - Bình composite áp suất cao $150k (ước tính).
    - Vỏ chịu nhiệt tính lại theo dòng khí êm hay xoáy và theo đường bay thật của game.
    - Thẻ Whipple và tấm giáp sửa theo vật lý; tấm tản nhiệt rẻ nhất.
  - **Gợi ý cho Role 3:** khoang demo Apollo (bản quét CC0 của Smithsonian). Phương án thay thế: Orion.

## 9. Đợt 6 (2026-11-08): hangar kiểu VAB High Bay 3 (ĐÃ CHỐT, Codex dựng mô hình)

- **Người dùng muốn:** sảnh tròn hiện tại nhìn giả, quá thấp (cao 15 m, trong khi tàu cao 8–36 m). Làm lại theo ảnh thật VAB High Bay 3 có SLS bên trong: giàn giáo thép khổng lồ, sàn công tác, có góc nhìn từ mặt đất ngước lên thấy cả con tàu.
- **Đã chốt:**
  - Gian cao cố định khoảng 80 m.
  - Các tầng sàn cách nhau khoảng 6 m, mỗi tầng hai nửa trượt ôm sát thân tàu, mép vàng cắt theo bán kính S/M/L. Tầng cao hơn đỉnh tàu hoặc ngang tầng có booster thì rút vào.
  - Người chơi đi bộ dưới mặt đất. Có thang máy trong tháp giàn giáo lên các tầng sàn.
  - **Tầng phi hành đoàn** là tầng ngang cửa khoang lái của con tàu đang lắp: có cầu dẫn (crew access arm) bắc tới cửa. Đi qua cầu, bấm E ở cửa → Readiness Poll → xác nhận → sàn rút ra (khoảng 1–2 s, âm thanh rầm rầm, khói) → sang phần bay của Role 2 như hiện nay.
  - Dãy 7 bàn máy tính đặt trên sàn nhà cạnh bệ tàu, quay mặt về tàu.
- **Chia việc:**
  - Codex dựng mô hình Blender theo mô-đun (dùng nhân bản InstancedMesh) và `layout.json`, kèm sandbox `sandbox/role1.hangar.html`. Codex chạy trong VS Code **chung thư mục** với Claude. Vì vậy Codex không chạy lệnh git nào làm thay đổi trạng thái (không add, commit, checkout, stash, push), không chạy `npm install`, chỉ ghi vào `tools/blender/hangar/`, `public/assets/models/builder/hangar/`, `sandbox/role1.hangar.*` và `tests/hangar-models.test.mjs`. Dev server của Codex dùng cổng 5280; cổng 5173 là của người dùng. Claude kiểm tra rồi commit (đứng tên Myklede, không có dòng Co-Authored-By).
  - Claude kiểm tra rồi lắp vào game: hangarScene, thang máy, sàn rút, cầu dẫn, bàn máy, âm thanh và khói.
  - Prompt gửi Codex: `C:/Users/Thainguyen/Downloads/CODEX-PROMPT-VAB-HANGAR.md`.

- **Codex 1 xong** (commit `4d303c8`, chưa push): khung VAB đúng như đã chốt, gồm 24 GLB, `layout.json`, sandbox và test. Nhưng trông "nhựa": thanh hộp đơn giản, một vật liệu phẳng, ánh sáng đều.
- **Codex 2 (người dùng chốt 2026-11-08):** tăng độ chân thật.
  - Khoảng 1 triệu tam giác, ≥ 60 FPS, tối đa 20 MB.
  - Texture CC0 (ambientCG, Poly Haven), nướng AO và vết bẩn.
  - Ánh sáng tối và sâu như ảnh Artemis.
  - Ưu tiên kết cấu thép thật, sàn lưới và lan can, mép sàn ôm tàu; đồ lặt vặt ít.
  - Sandbox phải dựng đúng chuỗi xử lý ảnh của game (bloom, tone mapping, HDRI).
  - Prompt: `C:/Users/Thainguyen/Downloads/CODEX2-PROMPT-VAB-DETAIL.md`.

- **Codex 2 xong** (commit `2db32c9`, nhãn `hangar-v2-backup` là bản dự phòng): người dùng rất ưng phần chi tiết khi nhìn gần, nhưng còn hai lỗi:
  - nhìn xa bị nhoè và lấp lánh: vẽ ở 60 % độ phân giải, sàn lưới tạo vân nhiễu;
  - đèn quá chói: độ sáng 1,15, quá nhiều đèn loá.
- **Codex 3 (người dùng chốt 2026-11-08):**
  - Sửa chói và nhoè: độ phân giải 1.0 có tự giảm, bản xa không dùng lưới lỗ, ít đèn loá.
  - Vành sàn ôm đúng thân tàu ở từng tầng: tấm điền hình nêm trượt vào theo góc, có vết cắt cho booster. Có hàm `fitCollar` để dùng lại trong game.
  - Sandbox vẽ con tàu thật bằng code builder (chỉ đọc, không sửa): chọn tàu mẫu và hình dáng thì tàu lớn và vành sàn đổi theo ngay.
  - Cụm bàn cong 4 máy ở tầng trệt: thời tiết và cửa sổ phóng sang sao Hỏa, máy build tàu, thử động cơ và mô phỏng bay, bàn chỉ huy Go/No-Go. Người ngồi quay lưng về phía tàu; đứng dậy quay người lại là thấy toàn cảnh tàu từ dưới nhìn lên.
  - Prompt: `C:/Users/Thainguyen/Downloads/CODEX3-PROMPT-VAB-CONSOLES.md`.

- **Codex v3 xong** (commit `b90cab3`, nhãn `hangar-v3`).
  - Hết chói; vẽ ở 100 % độ phân giải, tự hạ tối thiểu 80 %.
  - Vành sàn ôm đúng thân tàu; sandbox vẽ tàu thật; 4 bàn máy và hoạt cảnh quay người.
  - Claude sửa lỗi không kéo chuột được: module đồ hoạ của game tự tạo canvas phủ kín màn hình, nên sandbox phải ẩn nó.
- **Codex v4 (người dùng chốt 2026-11-08):**
  - Mỗi tầng là bệ ôm 3/4 vòng (270°) quanh tàu, chừa khe nhìn 90° quay về phía bàn máy và cửa (−Z). Từ bàn máy quay lại thấy trọn tàu qua khe.
  - Mỗi tầng chia 3 mảnh rút ra: trái và phải trượt ngang, mảnh sau lùi về phía sau. Thêm tháp hoặc giàn phía sau.
  - Thêm chi tiết kim loại như ảnh NASA: dầm vàng, ống đỏ, hộp thiết bị trắng, tủ điện cam, cột xanh, cầu thang giữa các tầng.
  - Làm đẹp 4 bàn máy theo Firing Room thật.
  - Camera sandbox bay tự do (WASD, Q/E, chuột phải) và có góc máy sẵn cho cụm bàn máy.
  - Giữ `?v=2` và `?v=3`.
  - Prompt: `C:/Users/Thainguyen/Downloads/CODEX4-PROMPT-VAB-WRAP.md`.
- **Codex v4 xong** (commit `87c79e4`, nhãn `hangar-v4-codex`, mở bằng `?v=4`): đủ chức năng nhưng người dùng chưa ưng:
  - khe nhìn thẳng ra cửa (nhìn trực diện);
  - mép sàn là 36 tấm hình nan quạt;
  - cầu thang dồn ở góc sau, không thấy từ bàn máy;
  - hai khối xám chắn chân tàu.
- **v5 (người dùng chốt 2026-11-08, Claude làm cùng đội sub-agent Opus 5.5 mức high):**
  - **Khe trống là góc phần tư trước-trái** (x < 0, z < 0): hai mép sàn thẳng vuông góc gặp nhau ở tàu, nhìn chéo vào như ảnh `vab_work_platforms_with_sls.webp`.
  - **Mép sàn là đường cong liền mạch** ôm thân tàu ở từng tầng, có vòng vàng; khoét cong theo booster.
  - **3 mảnh mỗi tầng:** trước-phải trượt +X, sau-phải lùi +Z, sau-trái trượt −X.
  - **Cụm 4 bàn máy dưới đất trên đường chéo trong khe**, người ngồi quay lưng với tàu.
    - Đứng dậy quay lại thì ngước lên thấy trọn tàu.
    - Khoảng cách: đủ xa để thấy cả tàu, đủ gần để thấy tàu khổng lồ.
    - Chụp thử 15, 18 và 22 m, người dùng chọn bằng mắt.
  - Thang máy dời sang góc trước-phải.
  - Làm hết chi tiết:
    - cầu thang và lối đi có lan can tới tàu;
    - cầu dẫn phi hành đoàn sát mép khe;
    - lan can, dầm vàng, mặt dưới sàn;
    - hộp trắng, tủ cam, ống đỏ, cột xanh;
    - bệ đỡ đẹp nhìn chéo.
  - Lúc ngồi: trước mặt là tường thật, tối.
  - **Cách làm:**
    - Claude dựng khung `sandbox/role1.hangar.v5.js` (commit `e12a966`).
    - 4 agent làm song song, mỗi agent một mảnh, có file JSON riêng trong `public/assets/models/builder/hangar/v5/`: sàn và vòng cong (decks), lối lên tàu (access), bàn máy và camera (stage), bệ đỡ (launcher).
    - Chạy Blender và trình duyệt qua khoá `v5lock.mjs`, mỗi lúc một cái, vì máy 14 GB.
    - Sau đó agent kiểm tra soát lại, Claude tổng kiểm tra.
    - Đề bài chung: `src/builder/tools/blender/hangar/V5-BRIEF.md`.

- **Đưa VAB vào game (người dùng chốt 2026-11-08, "Tui rất ưng thiết kế rồi"):** bỏ sảnh tròn cũ, HANGAR giờ là gian VAB v5.
  - Code game: `hangarScene.js` viết lại; phần chuyển từ sandbox nằm ở `bay/vab/` (`load.js` nạp layout + mảnh, `hall.js` nhân bản InstancedMesh + LOD + sàn trượt + va chạm, `collars.js`, `access.js` cầu dẫn, `mount.js` bệ phóng mảnh, `consoles.js` 4 bàn máy, `shipOutline.js` đo hình tàu, `smoke.js` khói). Game không import gì từ `sandbox/`.
  - Tàu đúng kích thước thật (không ×1,5), đứng trên bệ mảnh ở ML_TOP = 7. Gian giữ 44 × 44 m (người dùng huỷ việc nới tường gấp đôi).
  - Chỉ còn 4 bàn máy (dãy 22 m): WINDOW & WEATHER → thẻ Bệ phóng; SPACECRAFT DESIGN → trang thiết kế; ENGINE TEST & SIM → thử động cơ; LAUNCH DIRECTOR → Go/No-Go. Bỏ các bàn propulsion, structures, crew, warehouse; sổ tay vẫn mở bằng phím H.
  - Bấm E ở bàn: ngồi quay lưng về tàu, mở giao diện. Đóng giao diện: đứng dậy quay người, ngước lên thấy cả tàu.
  - Phóng: CONFIRM trong Go/No-Go → đứng dậy quay lại, sàn rút từ trên xuống (~1,5 s), âm thanh có sẵn (`cockpit.lock`, `engine.rumble` chậm, `impact.small`), khói ở ray sàn → PRELAUNCH. Thử động cơ cũng rút sàn và cầu dẫn, xong thì đóng lại.
  - Xoá `bay/room.js`, `bay/stations.js`, `bay/screen.js`. Thang máy và đi lên cầu dẫn để đợt sau.

## 5. Việc tồn đọng

- **Đã làm cho Role 3 (2026-11-08):**
  - Người dùng chốt khoang demo là **Apollo**.
  - Đã thêm `ShipSpec.stats.cabin = { type, windows, hatch, docking, couches, atmosphere, suits, volumeM3 }`.
  - Đã thêm tàu mẫu "Apollo" (`data/presets/apollo.json`): $4,91M, Δv 5.409/5.400, không cảnh báo.
  - Tài liệu khoang: `C:/Users/Thainguyen/Downloads/SpaceB-E-cabins-for-Role3.md` và https://claude.ai/artifact/7GaaeTkSwWYV9dWWHqffxg.
  - Mọi khoang đều có cửa sổ.
- Khoảng 58 model NASA không dùng (35 MB) còn trong repo; lệnh xoá hàng loạt từng bị chặn, cần người dùng cho phép.
- Model không còn dùng: `satkit_radio1.glb` (ăng-ten giờ vẽ tay), `shuttle_engines.glb` cho động cơ (vẫn đứng trong hangar).
- Tuỳ chọn: hook `surfaceRadius` cho designScene/hangarScene; thêm shape Super Heavy / N1; bước đường kính M ở Delta/Workhorse.
- Chưa có nút chọn đối xứng, chưa xoay/trượt đồ gắn hông.
- Linh kiện mới hiện hologram trong cảnh bay của Role 3 (đã ghi SHARE_PROBLEMS).

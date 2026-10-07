# Fox test builds

Закрытый каталог тестовых сборок OrangeFox для Galaxy A55 от EgaschNSK.

Сайт: https://egaschnsk.github.io/fox-test-builds/

API: https://fox-test-builds-api.fox-test-builds.workers.dev
Сайт размещается на GitHub Pages, аккаунты — в Cloudflare D1, файлы — в приватном Cloudflare R2. Публичной регистрации нет.

## Требования

Node.js 24+, GitHub CLI (`gh`), аккаунт GitHub и Cloudflare с включённым R2.
На этом компьютере Node уже установлен отдельно:

```sh
export PATH="$HOME/.local/share/fox-builds-tools/node/bin:$PATH"
cd ~/fox-builds-site
npm ci
```

Workers Free и бесплатные квоты D1/R2 подходят для небольшого тестового канала. Подписка Workers Paid не нужна для проверки случайных паролей. Это не обещание неограниченного бесплатного хранилища: следи за квотами в Cloudflare. [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/).

## Публикация

```sh
gh auth login
npx wrangler login
npx wrangler d1 create fox-test-builds
npx wrangler r2 bucket create fox-test-builds
```

В `wrangler.jsonc` замени `database_id` на ID созданной D1 и `ALLOWED_ORIGIN` на `https://ИМЯ_GITHUB.github.io` без пути и завершающего `/`. Оставь R2 приватным: не включай Public Development URL и не подключай публичный домен к бакету.

```sh
npx wrangler d1 execute fox-test-builds --remote --file worker/schema.sql
npx wrangler deploy
```

В `public/config.js` укажи полученный URL Worker в `PRODUCTION_API_URL`, например `https://fox-test-builds-api.ACCOUNT.workers.dev`.

```sh
gh repo create fox-test-builds --public --source . --remote origin
# В GitHub: Settings → Pages → Source → GitHub Actions.
git push -u origin main
```

Workflow публикует только `public/`. ZIP/IMG, аккаунты, пароли и локальные базы в Git не попадают. Перед push проверь `git status`.

На этом компьютере можно запускать команды из любой папки через `fox-site` — он сам подключает Node и выбирает каталог проекта:

```sh
~/fox-builds-site/fox-site account create tester_name --remote
~/fox-builds-site/fox-site upload /path/OrangeFox-a55x-test.zip --mode remote --branch 12.1 --version "07.10.2026 slottest"
```

`--notes /path/changelog.txt` необязателен; если его нет, пустой changelog на сайте не показывается. Название версии с пробелами заключай в кавычки.

## Аккаунты тестеров

```sh
npm run account -- create tester_name --remote
npm run account -- disable tester_name --remote
```

Создание запускай в своём терминале. Утилита покажет новый пароль один раз; передай его тестеру. Повторное `create` заменяет пароль и завершает старые сессии. `disable` сразу отзывает доступ, включая неиспользованные ссылки на скачивание. Регистр логина не важен.

Пароль генерируется из 24 криптографически случайных байт: `fox_` плюс 32 символа. Выбирать короткий пароль вручную нельзя. Это случайный секрет с 192 битами энтропии; в базе хранится только SHA-256 с индивидуальной солью, сравнение выполняется за постоянное время. Эта схема предназначена именно для случайных секретов, а не для человеческих паролей.

## Загрузка сборки

При желании запиши changelog на английском, по одному пункту на строку, в текстовый файл вне `public/`:

```sh
npm run upload -- /path/OrangeFox-a55x-test.zip \
  --mode remote --branch 16.0 --version R11.3-test \
  --notes /path/changelog.txt
```

Ветки: `12.1`, `14.1`, `16.0`. SHA256 и размер вычисляются из файла. Каталог появляется только после загрузки файла. Загрузки выполняй по очереди. Утилита ограничивает каталог 100 сборками и суммарным размером 8 ГиБ; это запас относительно бесплатной квоты R2, но не жёсткое ограничение расходов аккаунта.

Для архива скачай текущий каталог, поменяй у записи `status` на `archived` и верни каталог:

```sh
npx wrangler r2 object get fox-test-builds/catalog.json --remote --file .local/catalog-edit.json
# Отредактируй .local/catalog-edit.json; не удаляй остальные записи.
npx wrangler r2 object put fox-test-builds/catalog.json --remote --file .local/catalog-edit.json --content-type application/json
```

## Локальная проверка

```sh
npx wrangler d1 execute fox-test-builds --local --file worker/schema.sql
npm run account -- create preview --local
npm run dev:api
# Во втором терминале:
npm run dev:site
```

Открой http://localhost:8080. Локальные и удалённые D1/R2 раздельные; `--local` не меняет рабочий сайт. В уже подготовленном локальном просмотре есть макет ZIP с текстовым файлом, он не предназначен для прошивки.

```sh
npm test
npm run check:worker
npm audit
```

## Доступ к файлам

Каталог доступен только с действующей серверной сессией. Сессия живёт 12 часов и хранится в `sessionStorage` вкладки; в D1 сохраняется только хэш токена. Для скачивания Worker выдаёт одноразовую ссылку на 60 секунд, связанную с сессией. Она потоково передаёт файл из R2 и не раскрывает публичный адрес бакета. Выход, смена пароля и отключение аккаунта отзывают такие ссылки. Уже начавшуюся передачу файла отзыв не прерывает.

Докачки по Range нет: при обрыве нужно нажать «Скачать» заново. Попытки входа ограничены по IP и логину. Сайт требует HTTPS в рабочей конфигурации.

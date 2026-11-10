import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/auth";

/** Bump when the text of the consent changes: new sign-ups store this version next to the consent time. */
export const CONSENT_VERSION = "2026-11-10";

function useOperator() {
  const { settings, user } = useAuth();
  const panel = settings?.panelName || "MC Panel";
  const name = settings?.operatorName?.trim() || `администратор панели «${panel}»`;
  const contact = settings?.operatorContact?.trim() || "";
  return { panel, name, contact, user };
}

function Contact({ contact }: { contact: string }) {
  if (!contact) return <>через администратора панели</>;
  if (/^[^\s@]+@[^\s@]+$/.test(contact)) return <a href={`mailto:${contact}`}>{contact}</a>;
  if (/^@\w{4,}$/.test(contact)) return <a href={`https://t.me/${contact.slice(1)}`} target="_blank" rel="noreferrer">{contact}</a>;
  return <>{contact}</>;
}

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="min-h-dvh px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link to={user ? "/" : "/login"} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {user ? "В панель" : "Ко входу"}
          </Link>
          <Logo className="size-8" />
        </div>
        <Card className="p-6 sm:p-8">
          <article className="legal space-y-4 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-foreground [&_h2]:pt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground">
            <h1>{title}</h1>
            {children}
          </article>
        </Card>
        <LegalLinks className="mt-6" />
      </div>
    </div>
  );
}

export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-muted-foreground ${className}`}>
      <Link to="/privacy" className="hover:text-foreground hover:underline">
        Политика обработки данных
      </Link>
      {" · "}
      <Link to="/consent" className="hover:text-foreground hover:underline">
        Согласие на обработку
      </Link>
      <br />
      Используем только технические cookie, без которых не работает вход. Аналитики и рекламы нет.
    </p>
  );
}

function DataList() {
  return (
    <ul className="space-y-1">
      <li>имя пользователя (логин) и хэш пароля (сам пароль не хранится);</li>
      <li>адрес электронной почты, если вы его добавили;</li>
      <li>IP-адрес и сведения о браузере (User-Agent) при входе и в журнале действий;</li>
      <li>журнал ваших действий в панели: входы, запуск и остановка серверов, изменения настроек, с датой и IP;</li>
      <li>секрет двухфакторной защиты в зашифрованном виде, если вы её включили;</li>
      <li>файлы, настройки и логи ваших игровых серверов (в логах бывают ники игроков).</li>
    </ul>
  );
}

export function PrivacyPage() {
  const { panel, name, contact } = useOperator();
  return (
    <LegalLayout title="Политика обработки персональных данных">
      <p>
        Редакция от {CONSENT_VERSION.split("-").reverse().join(".")}. Документ объясняет, какие данные собирает панель «{panel}», зачем и как их защищает. Политика составлена по Федеральному закону
        № 152-ФЗ «О персональных данных».
      </p>

      <h2>1. Оператор</h2>
      <p>
        Оператор персональных данных: <strong>{name}</strong>. Связаться по вопросам данных: <Contact contact={contact} />.
      </p>

      <h2>2. Какие данные обрабатываются</h2>
      <DataList />

      <h2>3. Зачем</h2>
      <ul className="space-y-1">
        <li>дать вам доступ к панели и управлению вашими серверами;</li>
        <li>защитить аккаунт: ограничивать подбор паролей, показывать активные сессии, разбирать инциденты;</li>
        <li>восстановить доступ по ссылке из письма, если вы добавили почту;</li>
        <li>сообщать о важных событиях аккаунта (смена пароля, смена почты).</li>
      </ul>

      <h2>4. Основания</h2>
      <p>Ваше согласие (п. 1 ч. 1 ст. 6 152-ФЗ), которое вы даёте при регистрации отдельным документом, и исполнение соглашения об использовании панели (п. 5 ч. 1 ст. 6).</p>

      <h2>5. Как обрабатываются</h2>
      <p>
        Автоматизированно: сбор, запись, систематизация, накопление, хранение, уточнение, использование, удаление и уничтожение. Данные хранятся на сервере, где установлена панель. Пароли хранятся только в виде
        хэша (Argon2), секреты 2FA зашифрованы, вход защищён от подбора, вся связь идёт по HTTPS.
      </p>

      <h2>6. Кому передаются</h2>
      <p>
        Данные не продаются и не передаются третьим лицам для рекламы. Исключения: письма (сброс пароля, подтверждение почты) уходят через почтовый сервис оператора, ему передаётся только адрес получателя и
        текст письма. В каталоге модов браузер сам загружает картинки с сайтов Modrinth, CurseForge и Hangar, как при обычном открытии этих сайтов.
      </p>

      <h2>7. Сроки хранения</h2>
      <ul className="space-y-1">
        <li>данные аккаунта: пока аккаунт существует;</li>
        <li>сессии входа: до выхода из аккаунта, но не дольше 30 дней;</li>
        <li>журнал действий: 1 год, затем записи удаляются автоматически;</li>
        <li>ссылки сброса пароля и подтверждения почты: 30 минут и 24 часа соответственно.</li>
      </ul>

      <h2>8. Cookie и хранилище браузера</h2>
      <p>
        Панель ставит одну техническую cookie сессии: без неё нельзя войти. В хранилище браузера (localStorage) запоминаются настройки интерфейса, например тема и скрытые подсказки. Аналитики, счётчиков и
        рекламных трекеров нет.
      </p>

      <h2>9. Ваши права</h2>
      <p>
        Вы можете узнать, какие ваши данные обрабатываются, попросить их уточнить или удалить и отозвать согласие. Напишите оператору (<Contact contact={contact} />), ответ придёт в течение 10 рабочих дней.
        Почту можно удалить самостоятельно в разделе «Аккаунт», там же видны ваши сессии и действия. После отзыва согласия аккаунт и связанные с ним данные удаляются в течение 30 дней.
      </p>

      <h2>10. Дети</h2>
      <p>Если вам меньше 14 лет, зарегистрироваться можно только с разрешения родителей или других законных представителей.</p>

      <h2>11. Изменения</h2>
      <p>Новая редакция начинает действовать с момента публикации на этой странице. Дата редакции указана в начале документа.</p>
    </LegalLayout>
  );
}

export function ConsentPage() {
  const { panel, name, contact } = useOperator();
  return (
    <LegalLayout title="Согласие на обработку персональных данных">
      <p>
        Регистрируясь в панели «{panel}» и отмечая галочку согласия, я свободно, своей волей и в своём интересе даю согласие оператору <strong>{name}</strong> (контакт: <Contact contact={contact} />) на
        обработку моих персональных данных на следующих условиях.
      </p>

      <h2>Какие данные</h2>
      <DataList />

      <h2>Цели</h2>
      <p>Предоставление доступа к панели и управлению игровыми серверами, защита аккаунта, восстановление доступа по почте, служебные уведомления об аккаунте.</p>

      <h2>Действия с данными</h2>
      <p>Сбор, запись, систематизация, накопление, хранение, уточнение (обновление, изменение), извлечение, использование, удаление и уничтожение. Обработка автоматизированная.</p>

      <h2>Срок и отзыв</h2>
      <p>
        Согласие действует до удаления аккаунта или до его отзыва. Отозвать согласие можно в любой момент, написав оператору: <Contact contact={contact} />. После отзыва оператор прекращает обработку и удаляет
        данные в течение 30 дней, если закон не требует хранить их дольше.
      </p>

      <p>
        Подробнее о том, как обрабатываются данные, написано в <Link to="/privacy">Политике обработки персональных данных</Link>.
      </p>
      <p className="text-xs">Редакция от {CONSENT_VERSION.split("-").reverse().join(".")}.</p>
    </LegalLayout>
  );
}

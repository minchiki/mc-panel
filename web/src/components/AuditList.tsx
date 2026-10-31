import type { AuditEntry } from "@/lib/types";
import { formatDateFull } from "@/lib/format";

const LABELS: Record<string, string> = {
  "auth.login": "Вход",
  "auth.login_failed": "Неудачный вход",
  "auth.register": "Регистрация",
  "auth.password_changed": "Смена пароля",
  "auth.2fa_enabled": "Включена 2FA",
  "auth.2fa_disabled": "Отключена 2FA",
  "auth.api_key_created": "Создан API-ключ",
  "auth.api_key_deleted": "Удалён API-ключ",
  "server.create": "Создание сервера",
  "server.delete": "Удаление сервера",
  "server.start": "Запуск",
  "server.stop": "Остановка",
  "server.restart": "Перезапуск",
  "server.kill": "Kill",
  "server.command": "Команда",
  "server.update": "Изменение настроек",
  "server.properties": "server.properties",
  "server.reinstall": "Переустановка ядра",
  "server.network": "Сеть",
  "server.icon": "Новая иконка",
  "modlist.build": "Сборка по списку",
  "modlist.rebuild": "Пересборка пресета",
  "server.icon_delete": "Иконка убрана",
  "files.write": "Изменён файл",
  "files.upload": "Загрузка файлов",
  "files.delete": "Удаление файлов",
  "files.rename": "Переименование",
  "files.mkdir": "Новая папка",
  "files.zip": "Архивация",
  "files.unzip": "Распаковка",
  "backup.create": "Бэкап",
  "backup.restore": "Восстановление бэкапа",
  "backup.delete": "Удаление бэкапа",
  "schedule.save": "Задача сохранена",
  "schedule.delete": "Задача удалена",
  "schedule.run": "Выполнена задача",
  "addon.install": "Установка плагина",
  "addon.upload": "Загрузка плагина",
  "addon.toggle": "Вкл/выкл плагина",
  "addon.delete": "Удаление плагина",
  "database.create": "Создана база",
  "database.delete": "Удалена база",
  "database.reveal": "Просмотр данных БД",
  "database.rotate": "Смена пароля БД",
  "subuser.save": "Доступ помощника",
  "subuser.delete": "Удалён помощник",
};

export function actionLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  if (action.startsWith("players.")) return `Игроки: ${action.slice(8)}`;
  if (action.startsWith("admin.")) return `Админ: ${action.slice(6)}`;
  return action;
}

function shortDetails(details: string | null): string {
  if (!details) return "";
  try {
    const obj = JSON.parse(details) as Record<string, unknown>;
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(", ")
      .slice(0, 160);
  } catch {
    return details.slice(0, 160);
  }
}

export function AuditList({ entries, showServer }: { entries: AuditEntry[]; showServer?: boolean }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Записей нет.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-3 font-medium">Когда</th>
            <th className="py-2 pr-3 font-medium">Кто</th>
            <th className="py-2 pr-3 font-medium">Действие</th>
            {showServer && <th className="py-2 pr-3 font-medium">Сервер</th>}
            <th className="hidden py-2 pr-3 font-medium md:table-cell">Детали</th>
            <th className="hidden py-2 font-medium lg:table-cell">IP</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b align-top last:border-0">
              <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{formatDateFull(e.created_at)}</td>
              <td className="py-2 pr-3">{e.username ?? <span className="text-muted-foreground">система</span>}</td>
              <td className="py-2 pr-3 font-medium">{actionLabel(e.action)}</td>
              {showServer && <td className="py-2 pr-3 font-mono text-xs">{e.server_id ?? "—"}</td>}
              <td className="hidden max-w-md truncate py-2 pr-3 font-mono text-xs text-muted-foreground md:table-cell">{shortDetails(e.details)}</td>
              <td className="hidden py-2 font-mono text-xs text-muted-foreground lg:table-cell">{e.ip ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

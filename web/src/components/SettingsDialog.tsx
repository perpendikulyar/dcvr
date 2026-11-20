import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** LLM connection settings: Yandex AI Studio folder and API key. */
export function SettingsDialog({ open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, enabled: open });

  // null until edited: the field shows the saved value.
  const [folderEdit, setFolderEdit] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const save = useMutation({
    // An empty key field means "keep the saved key".
    mutationFn: () =>
      api.saveSettings({
        yandexFolderId: folderId,
        ...(apiKey.trim() && { yandexApiKey: apiKey }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      setFolderEdit(null);
      setApiKey('');
      test.reset();
    },
  });
  const test = useMutation({ mutationFn: api.testSettings });

  const saved = settings.data;
  const folderId = folderEdit ?? saved?.yandexFolderId ?? '';
  const dirty =
    Boolean(apiKey.trim()) || (saved !== undefined && folderId !== saved.yandexFolderId);

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose}>
      <form
        method="dialog"
        className="settings"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <header className="dialog__header">
          <h2>Настройки</h2>
          <button type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </header>

        <p className="muted">
          Для ИИ-анализа нужен доступ к YandexGPT (Yandex AI Studio): ID каталога Yandex Cloud и
          API-ключ сервисного аккаунта с ролью <code>ai.languageModels.user</code>. Настройки
          хранятся только на этом компьютере.
        </p>

        <label className="field">
          <span>ID каталога</span>
          <input
            value={folderId}
            onChange={(e) => setFolderEdit(e.target.value)}
            placeholder="b1g…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>API-ключ</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              saved?.yandexApiKeySet
                ? `Сохранён (${saved.yandexApiKeyHint}) — введите новый, чтобы заменить`
                : 'AQVN…'
            }
            autoComplete="off"
          />
        </label>

        {save.error && <p className="error">{save.error.message}</p>}
        {test.error && <p className="error">Не удалось подключиться: {test.error.message}</p>}
        {test.data && <p className="success">Подключение работает ({test.data.provider}).</p>}

        <footer className="actions">
          <button type="submit" className="primary" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Сохраняю…' : 'Сохранить'}
          </button>
          <button
            type="button"
            disabled={dirty || test.isPending || !saved?.yandexApiKeySet}
            title={dirty ? 'Сначала сохраните изменения' : undefined}
            onClick={() => test.mutate()}
          >
            {test.isPending ? 'Проверяю…' : 'Проверить подключение'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

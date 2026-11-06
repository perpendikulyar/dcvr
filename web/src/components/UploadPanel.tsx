import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Upload } from '@dcvr/shared';
import { api } from '../api/client';

interface Props {
  uploads: Upload[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export function UploadPanel({ uploads, selected, onSelect }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = useMutation({
    mutationFn: api.createUpload,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['uploads'] });
      onSelect(created.id);
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteUpload,
    onSuccess: async (_, id) => {
      if (id === selected) onSelect(null);
      await queryClient.invalidateQueries({ queryKey: ['uploads'] });
    },
  });

  const submit = (files: FileList | null) => {
    const file = files?.[0];
    if (file) upload.mutate(file);
  };

  return (
    <section className="panel">
      <h2>Выгрузки</h2>

      <div
        className={`dropzone${dragOver ? ' dropzone--active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          submit(e.dataTransfer.files);
        }}
      >
        {upload.isPending ? 'Загрузка…' : 'Перетащите CSV сюда или нажмите, чтобы выбрать'}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            submit(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {upload.error && <p className="error">{upload.error.message}</p>}
      {remove.error && <p className="error">{remove.error.message}</p>}

      <ul className="uploads">
        {uploads.map((u) => (
          <li
            key={u.id}
            className={u.id === selected ? 'uploads__item uploads__item--active' : 'uploads__item'}
          >
            <button className="uploads__select" onClick={() => onSelect(u.id)} title={u.filename}>
              <span className="uploads__name">{u.filename}</span>
              <span className="muted">
                {dateFormat.format(new Date(u.uploadedAt))} · {u.rowCount.toLocaleString('ru-RU')}{' '}
                строк
              </span>
            </button>
            <button
              className="icon-button"
              title="Удалить выгрузку"
              aria-label={`Удалить ${u.filename}`}
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`Удалить выгрузку «${u.filename}»?`)) remove.mutate(u.id);
              }}
            >
              ×
            </button>
          </li>
        ))}
        {!uploads.length && <li className="muted">Пока нет загруженных файлов</li>}
      </ul>
    </section>
  );
}

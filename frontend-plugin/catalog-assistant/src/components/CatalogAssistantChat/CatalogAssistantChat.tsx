/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useEffect, useRef, useState } from 'react';
import useAsync from 'react-use/lib/useAsync';
import { useApi } from '@backstage/core-plugin-api';
import { MarkdownContent } from '@backstage/core-components';
import {
  Box,
  Chip,
  CircularProgress,
  Fab,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
  makeStyles,
} from '@material-ui/core';
import ChatIcon from '@material-ui/icons/QuestionAnswer';
import CloseIcon from '@material-ui/icons/Close';
import DeleteOutlineIcon from '@material-ui/icons/DeleteOutline';
import SendIcon from '@material-ui/icons/Send';
import { catalogAssistantApiRef, ChatMessage } from '../../api/types';

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; citations: string[] }
  | { role: 'error'; text: string };

/** Conversation is kept per browser session until the user clears it. */
const STORAGE_KEY = 'catalog-assistant-chat';

function loadMessages(): Message[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

const useStyles = makeStyles(theme => ({
  fab: {
    position: 'fixed',
    bottom: theme.spacing(3),
    right: theme.spacing(3),
    zIndex: theme.zIndex.tooltip,
  },
  panel: {
    position: 'fixed',
    bottom: theme.spacing(3),
    right: theme.spacing(3),
    width: 400,
    maxWidth: 'calc(100vw - 32px)',
    height: 560,
    maxHeight: 'calc(100vh - 96px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: theme.zIndex.tooltip,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1, 2),
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },
  user: {
    alignSelf: 'flex-end',
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
    borderRadius: 8,
    padding: theme.spacing(1, 1.5),
    maxWidth: '85%',
  },
  assistant: {
    alignSelf: 'flex-start',
    backgroundColor: theme.palette.background.default,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    padding: theme.spacing(1, 1.5),
    maxWidth: '95%',
  },
  footer: {
    padding: theme.spacing(1, 2, 2),
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  inputRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: theme.spacing(1),
  },
}));

export const CatalogAssistantChat = () => {
  const classes = useStyles();
  const api = useApi(catalogAssistantApiRef);

  const [open, setOpen] = useState(false);
  const [model, setModel] = useState('');
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const endRef = useRef<HTMLDivElement>(null);

  // Persist the conversation for the browser session.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore storage quota / disabled storage */
    }
  }, [messages]);

  const clearConversation = () => {
    setMessages([]);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const { value: modelsResp } = useAsync(() => api.listModels(), [api]);
  const models = modelsResp?.models ?? [];

  useEffect(() => {
    if (modelsResp && !model) {
      setModel(modelsResp.default ?? modelsResp.models[0]?.id ?? '');
    }
  }, [modelsResp, model]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, asking]);

  const send = async () => {
    const q = input.trim();
    if (!q || asking) {
      return;
    }
    // Prior turns (excluding errors), captured before adding the new question.
    const history: ChatMessage[] = messages
      .filter(
        (m): m is Extract<Message, { role: 'user' | 'assistant' }> =>
          m.role === 'user' || m.role === 'assistant',
      )
      .map(m => ({ role: m.role, content: m.text }));

    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setInput('');
    setAsking(true);
    try {
      const res = await api.query(q, model || undefined, history);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: res.answer, citations: res.citations },
      ]);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        { role: 'error', text: (e as Error).message },
      ]);
    } finally {
      setAsking(false);
    }
  };

  if (!open) {
    return (
      <Fab
        color="primary"
        className={classes.fab}
        onClick={() => setOpen(true)}
        aria-label="Ask the catalog assistant"
      >
        <ChatIcon />
      </Fab>
    );
  }

  return (
    <Paper elevation={8} className={classes.panel}>
      <div className={classes.header}>
        <Typography variant="subtitle1">Catalog Assistant</Typography>
        <Box>
          <IconButton
            size="small"
            onClick={clearConversation}
            disabled={messages.length === 0}
            style={{ color: 'inherit' }}
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => setOpen(false)}
            style={{ color: 'inherit' }}
            aria-label="Close"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </div>

      <div className={classes.messages}>
        {messages.length === 0 && (
          <Typography variant="body2" color="textSecondary">
            Ask a question about your catalog, e.g. “Who owns the payments
            service?”
          </Typography>
        )}
        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <Box key={i} className={classes.user}>
                <Typography variant="body2">{msg.text}</Typography>
              </Box>
            );
          }
          if (msg.role === 'error') {
            return (
              <Box key={i} className={classes.assistant}>
                <Typography variant="body2" color="error">
                  {msg.text}
                </Typography>
              </Box>
            );
          }
          return (
            <Box key={i} className={classes.assistant}>
              <MarkdownContent content={msg.text} />
              {msg.citations.length > 0 && (
                <Box mt={1} display="flex" flexWrap="wrap" gridGap={4}>
                  {msg.citations.map(c => (
                    <Chip key={c} label={c} size="small" />
                  ))}
                </Box>
              )}
            </Box>
          );
        })}
        {asking && (
          <Box className={classes.assistant}>
            <CircularProgress size={18} />
          </Box>
        )}
        <div ref={endRef} />
      </div>

      <div className={classes.footer}>
        {models.length > 0 && (
          <FormControl fullWidth size="small" style={{ marginBottom: 8 }}>
            <InputLabel id="ca-chat-model">Model</InputLabel>
            <Select
              labelId="ca-chat-model"
              value={model}
              onChange={e => setModel(e.target.value as string)}
            >
              {models.map(m => (
                <MenuItem key={m.id} value={m.id}>
                  {m.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <div className={classes.inputRow}>
          <TextField
            placeholder="Ask the catalog…"
            fullWidth
            multiline
            maxRows={4}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <IconButton
            color="primary"
            onClick={send}
            disabled={asking || !input.trim()}
            aria-label="Send"
          >
            <SendIcon />
          </IconButton>
        </div>
      </div>
    </Paper>
  );
};

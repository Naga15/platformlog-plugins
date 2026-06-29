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

import React, { useEffect, useState } from 'react';
import useAsync from 'react-use/lib/useAsync';
import {
  Content,
  ContentHeader,
  Header,
  InfoCard,
  MarkdownContent,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import {
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@material-ui/core';
import { catalogAssistantApiRef, QueryResult } from '../../api/types';

export const CatalogAssistantPage = () => {
  const api = useApi(catalogAssistantApiRef);

  const {
    value: modelsResp,
    loading: modelsLoading,
    error: modelsError,
  } = useAsync(() => api.listModels(), [api]);

  const [model, setModel] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<QueryResult | undefined>();
  const [askError, setAskError] = useState<Error | undefined>();

  // Default the dropdown to the backend's default once models load.
  useEffect(() => {
    if (modelsResp && !model) {
      setModel(modelsResp.default ?? modelsResp.models[0]?.id ?? '');
    }
  }, [modelsResp, model]);

  const models = modelsResp?.models ?? [];

  const onAsk = async () => {
    const q = question.trim();
    if (!q) {
      return;
    }
    setAsking(true);
    setAskError(undefined);
    setResult(undefined);
    try {
      setResult(await api.query(q, model || undefined));
    } catch (e) {
      setAskError(e as Error);
    } finally {
      setAsking(false);
    }
  };

  return (
    <Page themeId="tool">
      <Header
        title="Catalog Assistant"
        subtitle="Ask grounded questions about your software catalog"
      />
      <Content>
        <ContentHeader title="Ask a question" />
        <InfoCard>
          {modelsError && <ResponseErrorPanel error={modelsError} />}
          <Box display="flex" flexDirection="column" gridGap={16}>
            <TextField
              label="Question"
              placeholder="Who owns the payments service?"
              variant="outlined"
              fullWidth
              multiline
              minRows={2}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => {
                // Cmd/Ctrl+Enter submits.
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  onAsk();
                }
              }}
            />
            <Box display="flex" alignItems="center" gridGap={16}>
              {models.length > 0 && (
                <FormControl variant="outlined" style={{ minWidth: 280 }}>
                  <InputLabel id="ca-model-label">Model</InputLabel>
                  <Select
                    labelId="ca-model-label"
                    label="Model"
                    value={model}
                    onChange={e => setModel(e.target.value as string)}
                    disabled={modelsLoading}
                  >
                    {models.map(m => (
                      <MenuItem key={m.id} value={m.id}>
                        {m.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <Button
                variant="contained"
                color="primary"
                onClick={onAsk}
                disabled={asking || !question.trim()}
              >
                {asking ? 'Asking…' : 'Ask'}
              </Button>
            </Box>
          </Box>
        </InfoCard>

        <Box mt={3}>
          {asking && <Progress />}
          {askError && <ResponseErrorPanel error={askError} />}
          {result && (
            <InfoCard title="Answer">
              <MarkdownContent content={result.answer} />
              {result.citations.length > 0 && (
                <Box mt={2}>
                  <Typography variant="subtitle2" gutterBottom>
                    Citations
                  </Typography>
                  <Box display="flex" flexWrap="wrap" gridGap={8}>
                    {result.citations.map(c => (
                      <Chip key={c} label={c} size="small" />
                    ))}
                  </Box>
                </Box>
              )}
            </InfoCard>
          )}
        </Box>
      </Content>
    </Page>
  );
};

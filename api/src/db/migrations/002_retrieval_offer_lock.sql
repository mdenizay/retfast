CREATE UNIQUE INDEX IF NOT EXISTS retrieval_one_open_offer_per_retriever
  ON retrieval_jobs (event_id, offered_retriever_id)
  WHERE status = 'offered';

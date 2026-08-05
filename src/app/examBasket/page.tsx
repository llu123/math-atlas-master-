import ExamBasketView from '@/components/ExamBasketView';
import { scanAllQuestionsMeta } from '@/lib/questions';

export default function ExamBasketPage() {
  const questions = scanAllQuestionsMeta();

  return (
    <ExamBasketView questions={questions} />
  );
}
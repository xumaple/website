import { useRouter } from 'next/router'

export default function Post({ text }) {
  const router = useRouter();
  const { prid } = router.query;

  return <p>Project: {prid}{text}</p>
}
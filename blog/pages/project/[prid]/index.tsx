import { useRouter } from 'next/router'
import db from '../../../firebase/model.ts';
import { POST_FILENAME_C, PROJ_LIST_C, POST_LIST_C, PROJ_ORDER_C } from '../../../consts.ts';
import readPostFile from './post/readPostFile';
import Head from 'next/head'
import Image from 'next/image'
import styles from '../../../styles/Home.module.css'
import Markdown from 'react-markdown';


export async function getStaticProps(context) {
  const ref = db.ref(PROJ_LIST_C).child(context.params.prid);

  let proj = (await ref.once('value')).val()
  let posts = [];
  await ref.child(POST_LIST_C).orderByChild(POST_FILENAME_C).on('value', s => {
    s.forEach(p => {
      posts.push({key:p.key, post: p.val()});
    });
  });

  for (let p of posts) {
    let {post} = p;
    post.title = (await readPostFile(post.filename)).split('\n')[0].split('# ').slice(-1)[0];
    if (post.title === undefined) post.title = "";
  }
  return { props: { proj, posts } };
}

export async function getStaticPaths() {
  const paths = (await db.getChildrenKeys(PROJ_LIST_C, PROJ_ORDER_C)).map(prid => ({
    params: { prid }
  }));

  return { paths, fallback: false };
}

export default function Project({ proj, posts }) {
  const router = useRouter();
  const { prid } = router.query;

  if (proj === undefined) return "";

  const {name} = proj;
  return (
    <div className={styles.container}>
      <Head>
        <title>{name}</title>
        <meta name="description" content={name} />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>
          {name}
        </h1>

        <div className={styles.grid}>
          {posts?posts.map(({key, post}) => <a
            className={styles.card} 
            href={key?`/project/${prid}/post/${key}`:undefined}
          >
            <h2><Markdown>{post.title}</Markdown> &rarr;</h2>
            <p>{proj.description}</p>
          </a>):""}
        </div>
      </main>

      <footer className={styles.footer}>
        <a
          href="https://vercel.com?utm_source=create-next-app&utm_medium=default-template&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by{' '}
          <span className={styles.logo}>
            <Image src="/vercel.svg" alt="Vercel Logo" width={72} height={16} />
          </span>
        </a>
      </footer>
    </div>
  )
}
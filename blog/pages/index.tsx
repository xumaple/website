import Head from 'next/head'
import Image from 'next/image'
import styles from '../styles/Home.module.css'
import db from '../firebase/model.ts';
import { PROJ_LIST_C, PROJ_ORDER_C } from '../consts.ts';

export async function getStaticProps(context) {
  let projects = (await db.getChildrenKeyVals(PROJ_LIST_C, PROJ_ORDER_C)).map((p) => ({
    prid: p.key, ...p.val
  }));
  projects.push({name: 'My next project', description: 'Coming soon!', order: 99999});
  console.log(projects)
  return { props: { projects } };
}

export default function Home({ projects }) {
  return (
    <div className={styles.container}>
      <Head>
        <title>Blog</title>
        <meta name="description" content="Maple Xu's Tech Blog!" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>
          Welcome to my blog!
        </h1>

        <div className={styles.grid}>
          {projects.map(project=><a
            className={styles.card} 
            href={project.prid?"/project/".concat(project.prid):undefined}
          >
            <h2>{project.name} &rarr;</h2>
            <p>{project.description}</p>
          </a>)}
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

import db from '../../../../firebase/model.ts';
import Markdown from 'react-markdown';
import { POST_FILENAME_C, PROJ_LIST_C, POST_LIST_C } from '../../../../consts.ts';
import readPostFile from './readPostFile';
import styles from '../../../../styles/Home.module.css'
import Image from 'next/image'

export async function getStaticPaths() {
  let paths = [].concat.apply([], 
    (await db.getChildrenKeyVals(PROJ_LIST_C, 'order')).map(({key, val}) => 
      Object.entries(val[POST_LIST_C]).map(([pid, _]) => (
        {params: {prid: key, pid}}
      ))
    )
  );
  return { paths, fallback: false }
}

export async function getStaticProps(context) {
  let post = (await db.ref(PROJ_LIST_C).child(context.params.prid).child(POST_LIST_C).child(context.params.pid).once('value')).val();

  post.text = await readPostFile(post.filename);

  return {props: post };
}

export default function Post(props) {
  const { filename, text } = props;
  // console.log(db.ref('test'));
  // console.log(text);

  return <div>This is the pid for file {props[POST_FILENAME_C]} in the url: 
    <Markdown 
    // transformImageUri={uri =>
    //   uri.startsWith("pictures") ? `../../../data/posts/${uri}` : uri
    // }
      components={{
        p: ({ node, children }) => {
          const img = node.children[0];
          // if (img.tagName==="img")console.log(img);
          return img.tagName === "img" ? 
            <div className={styles.image}><Image
              // loader={({src}) => (`localhost:3000/${src}`)}
              src={`/${img.properties.src}`}
              alt={img.properties.alt}
              width="50%" height="50%" layout="responsive" objectFit="contain"
              // height="768"
              // width="432"
              // placeholder="blur"
            /></div>
          : <div>{children}<p></p></div>;
        }, 
        code: ({ node, children }) => <code className={styles.code} {...node.properties} >{children}</code>,
        a: ({ node, children }) => <a className={styles.hyperlink} {...node.properties} target="_blank" >{children}</a>,
        h2: ({ node, children }) => <h2 className={styles.h2} {...node.properties} >{children}</h2>,
      }}
    >
      {text}
    </Markdown>
  </div>
}
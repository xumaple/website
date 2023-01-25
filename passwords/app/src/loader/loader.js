import './loader.css';

export const showLoader = () => document.querySelector('.loader').classList.remove('loader--hide');
export const hideLoader = () => document.querySelector('.loader').classList.add('loader--hide');
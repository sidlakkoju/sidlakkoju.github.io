import React from 'react';

const Home: React.FC = () => {
  return (
    <div>
      <section className="text-center mt-8">
        <img src="/profile-pic.jpg" alt="Profile Picture" className="w-32 h-32 rounded-full mx-auto" />
        <h2 className="text-3xl mt-4">Your Name</h2>
        <p className="text-gray-600">Software Developer</p>
        <p className="mt-4">Welcome to my personal webpage! Here you can find more about me and my work.</p>
      </section>

      <section className="mt-8">
        <h3 className="text-2xl">About Me</h3>
        <p className="mt-2">I am a software developer with a passion for building web applications. I love working with modern web technologies and constantly learning new things.</p>
      </section>

      <section className="mt-8">
        <h3 className="text-2xl">Projects</h3>
        <ul className="mt-2">
          <li>Project 1 - Description</li>
          <li>Project 2 - Description</li>
          <li>Project 3 - Description</li>
        </ul>
      </section>
    </div>
  );
};

export default Home;
